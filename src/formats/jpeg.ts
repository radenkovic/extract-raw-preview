/**
 * JPEG extractor (SPEC §6).
 *
 * The primary image is not a preview. The thumbnail lives in EXIF IFD1 as a
 * `JPEGInterchangeFormat` blob inside the APP1 segment.
 */

import { extractJpegAt } from "../jpeg.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { extractJpegExifPreviews } from "./shared.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "jpeg";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  // Bound the walk to a complete JPEG if one is present; otherwise use the
  // whole buffer (sniffing already required an SOI).
  const jpeg = extractJpegAt(reader.bytes, 0) ?? reader.bytes;
  return extractJpegExifPreviews(jpeg);
}
