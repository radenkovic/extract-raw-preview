/**
 * AVIF extractor.
 *
 * Copies JPEG or PNG image items when present. Otherwise decodes the AV1
 * image and JPEG-encodes it.
 */

import { extractStoredHeifPreviews } from "../heif.js";
import type { Reader } from "../reader.js";
import { decodeAvifToJpeg } from "../reencode.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { candidateFromReencoded } from "./shared.js";

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "avif";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  const stored = extractStoredHeifPreviews(reader);
  if (stored.length > 0) return stored;
  const decoded = await decodeAvifToJpeg(reader.bytes);
  if (!decoded) return [];
  return [candidateFromReencoded(decoded.data, decoded.width, decoded.height)];
}
