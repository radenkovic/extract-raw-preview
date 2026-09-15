/**
 * Panasonic RW2 extractor (SPEC §6).
 *
 * RW2 is TIFF-like with magic `IIU\0` (85) instead of 42. The embedded JPEG
 * preview is Panasonic tag 0x002E (`JpgFromRaw`); that JPEG often also carries
 * an EXIF IFD1 thumbnail.
 */

import { findEntry, readIfd, readTiffHeader, Tag, TiffMagic } from "../ifd.js";
import { extractJpegAt } from "../jpeg.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import {
  candidateFromImageBytes,
  extractJpegExifPreviews,
  extractTiffPreviews,
  uniqueCandidates,
} from "./shared.js";

/** PanasonicRaw JpgFromRaw (type UNDEFINED, offset + byte count). */
const PANASONIC_JPG_FROM_RAW = 0x002e;

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "rw2";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  const fromIfds = extractTiffPreviews(reader, {
    pointerTags: [Tag.SubIFDs],
    magics: [TiffMagic.rw2],
  });

  const extra: ThumbnailCandidate[] = [];
  const header = readTiffHeader(reader, { magics: [TiffMagic.rw2] });
  const ifd0 = readIfd(reader, header.firstIfdOffset, header.littleEndian);
  const entry = findEntry(ifd0, PANASONIC_JPG_FROM_RAW);
  if (entry && reader.has(entry.valueOffset, 2)) {
    const jpeg = extractJpegAt(reader.bytes, entry.valueOffset);
    if (jpeg) {
      const candidate = candidateFromImageBytes(jpeg);
      if (candidate) extra.push(candidate);
      extra.push(...extractJpegExifPreviews(jpeg));
    }
  }

  return uniqueCandidates([...fromIfds, ...extra]);
}
