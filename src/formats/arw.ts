/**
 * Sony ARW extractor (SPEC §6).
 *
 * ARW is a TIFF container. Preview JPEGs are stored as
 * `JPEGInterchangeFormat` blobs on IFD0 / IFD1.
 */

import { Tag } from "../ifd.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { extractTiffPreviews } from "./shared.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "arw";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  return extractTiffPreviews(reader, { pointerTags: [Tag.SubIFDs] });
}
