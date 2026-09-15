/**
 * DNG extractor (SPEC §6).
 *
 * DNG stores preview images as `SubIFDs` of IFD0, each a reduced-resolution
 * image with JPEG compression. The walker is the shared TIFF one; only the
 * configuration differs.
 *
 * Note on SPEC §5.4/§6: the "`PreviewIFD`" tag named there is not part of the
 * DNG specification — `PreviewIFD` is a Nikon maker-note tag (0x0011). Adobe's
 * DNG spec uses `SubIFDs` (0x014A) plus `NewSubfileType`, which is what is
 * implemented and what the v0.1 fixture exercises.
 */

import { Tag } from "../ifd.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { extractTiffPreviews } from "./shared.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "dng";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  return extractTiffPreviews(reader, { pointerTags: [Tag.SubIFDs] });
}
