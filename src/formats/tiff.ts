/**
 * TIFF extractor (SPEC §6).
 *
 * Any IFD with JPEG compression (6 or 7) holding strips, or a
 * `JPEGInterchangeFormat` thumbnail, is a candidate. `SubIFDs` are followed
 * because multi-image TIFFs nest their reduced-resolution images there.
 */

import { Tag } from "../ifd.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { extractTiffPreviews } from "./shared.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "tiff";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  return extractTiffPreviews(reader, { pointerTags: [Tag.SubIFDs] });
}
