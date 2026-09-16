/**
 * Photoshop Large Document (PSB) extractor (SPEC §6).
 *
 * Same image-resource thumbnail as PSD (resource 1036). The file header
 * version is 2; resource lengths remain 32-bit.
 */

import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { extractPhotoshopPreviews } from "./psd.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "psb";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  return extractPhotoshopPreviews(reader);
}
