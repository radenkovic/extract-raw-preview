/**
 * Fujifilm RAF extractor (SPEC §6).
 *
 * RAF is a proprietary header followed by a JPEG preview. Offset 84 holds a
 * big-endian pointer to that JPEG; the JPEG itself often carries a smaller
 * EXIF IFD1 thumbnail.
 */

import { extractJpegAt } from "../jpeg.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { candidateFromImageBytes, extractJpegExifPreviews, uniqueCandidates } from "./shared.js";

/** Big-endian JPEG offset in the RAF header. */
const RAF_JPEG_OFFSET = 84;

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "raf";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  if (!reader.has(RAF_JPEG_OFFSET, 4)) return [];
  const offset = reader.u32(RAF_JPEG_OFFSET, false);
  const jpeg = extractJpegAt(reader.bytes, offset);
  if (!jpeg) return [];
  const preview = candidateFromImageBytes(jpeg);
  const nested = extractJpegExifPreviews(jpeg);
  return uniqueCandidates(preview ? [preview, ...nested] : nested);
}
