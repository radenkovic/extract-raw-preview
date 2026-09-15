/**
 * CR2 extractor (SPEC §6).
 *
 * CR2 is a TIFF container with the canonical signature `CR\x02\x00` at offset 8.
 * The next-IFD chain runs IFD0 → IFD1 → IFD2 → IFD3; the small thumbnail lives
 * in IFD1 as a `JPEGInterchangeFormat` blob and the larger preview in IFD3 as
 * JPEG-compressed strips. The canonical header also records the raw IFD offset,
 * which `extractTiffPreviews` seeds the walk with.
 */

import { Tag } from "../ifd.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { extractTiffPreviews } from "./shared.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "cr2";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  return extractTiffPreviews(reader, { pointerTags: [Tag.SubIFDs] });
}
