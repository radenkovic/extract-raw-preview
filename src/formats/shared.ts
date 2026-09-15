/**
 * Preview collection shared by every TIFF-container format (SPEC §5.3, §5.4).
 *
 * Format modules configure this rather than re-implementing it: registering a
 * format is one new file plus one line in `registry.ts`.
 */

import {
  Compression,
  findEntry,
  type Ifd,
  readExifImageSize,
  readTiffHeader,
  readUint,
  readUintValues,
  Tag,
  walkIfds,
} from "../ifd.js";
import { type ImageInfo, inspectImage } from "../jpeg.js";
import type { Reader } from "../reader.js";
import type { ThumbnailCandidate } from "../types.js";

export interface PreviewExtractionOptions {
  /**
   * IFD-pointer tags to follow in addition to the next-IFD chain.
   * Defaults to `SubIFDs`, which is how DNG stores its preview images and how
   * multi-image TIFFs nest them.
   */
  pointerTags?: readonly number[];
  /** Extra IFD seeds beyond the container header's first IFD. */
  extraSeeds?: readonly number[];
}

export function isJpegCompression(compression: number | undefined): boolean {
  return compression === Compression.oldJpeg || compression === Compression.jpeg;
}

/**
 * Dimension resolution order (SPEC §6).
 *
 * 1. The IFD's own `ImageWidth`/`ImageLength`. The container is authoritative
 *    for the image it describes; some real-world lossless JPEG previews declare
 *    a *slice* in their frame header (the Kodak DCS520C stores two 868-pixel
 *    halves for a 1736-pixel image), so the tags must win.
 * 2. The frame header of a *decodable* stream, for candidates whose IFD carries
 *    no dimensions (the CR2 thumbnail IFD).
 * 3. The file-level EXIF image size, for non-decodable streams that describe a
 *    slice layout rather than an image layout.
 * 4. Whatever the frame header said, even when empty.
 */
function resolveDimensions(
  reader: Reader,
  ifd: Ifd,
  littleEndian: boolean,
  info: ImageInfo,
  exifSize: { width: number; height: number } | undefined,
): { width: number; height: number } {
  const tagWidth = readUint(reader, ifd, Tag.ImageWidth, littleEndian);
  const tagHeight = readUint(reader, ifd, Tag.ImageLength, littleEndian);
  if (tagWidth !== undefined && tagHeight !== undefined && tagWidth > 0 && tagHeight > 0) {
    return { width: tagWidth, height: tagHeight };
  }
  if (info.decodable && info.width > 0 && info.height > 0) {
    return { width: info.width, height: info.height };
  }
  if (exifSize) return exifSize;
  return { width: info.width, height: info.height };
}

/** Identifies `data` and wraps it as a candidate, or rejects it. */
function buildCandidate(
  reader: Reader,
  ifd: Ifd,
  littleEndian: boolean,
  data: Uint8Array,
  exifSize: { width: number; height: number } | undefined,
): ThumbnailCandidate | undefined {
  const info = inspectImage(data);
  if (!info) return undefined;

  const { width, height } = resolveDimensions(reader, ifd, littleEndian, info, exifSize);
  return {
    data,
    mimeType: info.mimeType,
    width,
    height,
    byteLength: data.byteLength,
    origin: info.mimeType === "image/png" ? "embedded-png" : "embedded-jpeg",
    decodable: info.decodable,
    kind: info.kind,
  };
}

/**
 * JPEG stored directly in strips (compression 6 or 7). Multi-strip images are
 * concatenated into one freshly allocated buffer, so the caller never observes
 * a view into the container (SPEC §3.1).
 */
function candidateFromStrips(
  reader: Reader,
  ifd: Ifd,
  littleEndian: boolean,
  exifSize: { width: number; height: number } | undefined,
): ThumbnailCandidate | undefined {
  const compression = readUint(reader, ifd, Tag.Compression, littleEndian);
  if (!isJpegCompression(compression)) return undefined;

  const offsetsEntry = findEntry(ifd, Tag.StripOffsets);
  const countsEntry = findEntry(ifd, Tag.StripByteCounts);
  if (!offsetsEntry || !countsEntry) return undefined;

  const offsets = readUintValues(reader, offsetsEntry, littleEndian);
  const counts = readUintValues(reader, countsEntry, littleEndian);
  if (offsets.length === 0 || offsets.length !== counts.length) return undefined;

  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total <= 0) return undefined;

  const data = new Uint8Array(total);
  let written = 0;
  for (let i = 0; i < offsets.length; i++) {
    const offset = offsets[i];
    const count = counts[i];
    if (!reader.has(offset, count)) return undefined; // optional structure: absent
    data.set(reader.bytes.subarray(offset, offset + count), written);
    written += count;
  }

  return buildCandidate(reader, ifd, littleEndian, data, exifSize);
}

/**
 * JPEG referenced by `JPEGInterchangeFormat` (+ length). This is the classic
 * EXIF thumbnail location and, in CR2, the IFD1 thumbnail. Compression is not
 * required here: real CR2 thumbnail IFDs omit the tag entirely.
 */
function candidateFromJpegInterchangeFormat(
  reader: Reader,
  ifd: Ifd,
  littleEndian: boolean,
  exifSize: { width: number; height: number } | undefined,
): ThumbnailCandidate | undefined {
  const offset = readUint(reader, ifd, Tag.JPEGInterchangeFormat, littleEndian);
  const length = readUint(reader, ifd, Tag.JPEGInterchangeFormatLength, littleEndian);
  if (offset === undefined || length === undefined || length <= 0) return undefined;
  if (!reader.has(offset, length)) return undefined;

  return buildCandidate(reader, ifd, littleEndian, reader.slice(offset, length), exifSize);
}

/**
 * Walks the container and returns every embedded preview it can identify,
 * including non-decodable ones, which `listThumbnails` exposes for inspection.
 */
export function extractTiffPreviews(
  reader: Reader,
  options: PreviewExtractionOptions = {},
): ThumbnailCandidate[] {
  const header = readTiffHeader(reader);
  const pointerTags = options.pointerTags ?? [Tag.SubIFDs];

  // CR2 records the raw IFD in its canonical header as well as in the chain.
  const seeds = [header.firstIfdOffset];
  if (header.cr2RawIfdOffset !== undefined) seeds.push(header.cr2RawIfdOffset);
  if (options.extraSeeds) seeds.push(...options.extraSeeds);

  const ifds = walkIfds(reader, header.littleEndian, seeds, { pointerTags });
  const ifd0 = ifds.find((ifd) => ifd.offset === header.firstIfdOffset);
  const exifSize = readExifImageSize(reader, header.littleEndian, ifd0);

  const candidates: ThumbnailCandidate[] = [];
  for (const ifd of ifds) {
    const strips = candidateFromStrips(reader, ifd, header.littleEndian, exifSize);
    if (strips) candidates.push(strips);

    const interchange = candidateFromJpegInterchangeFormat(
      reader,
      ifd,
      header.littleEndian,
      exifSize,
    );
    if (interchange) candidates.push(interchange);
  }
  return candidates;
}
