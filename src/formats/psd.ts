/**
 * Photoshop PSD extractor (SPEC §6).
 *
 * PSD stores a JPEG thumbnail in image resource 1036 (Photoshop 5+), after a
 * 28-byte header. Resource 1033 is the older BGR form and is only used when
 * its format field says JPEG.
 */

import { extractJpegAt } from "../jpeg.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { candidateFromImageBytes } from "./shared.js";

const RESOURCE_THUMB_OLD = 1033;
const RESOURCE_THUMB = 1036;
const THUMB_HEADER = 28;
const JPEG_FORMAT = 1;

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "psd";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  if (!reader.has(26, 8)) return [];

  let offset = 26;
  const colorLen = reader.u32(offset, false);
  offset += 4;
  if (!reader.has(offset, colorLen)) return [];
  offset += colorLen;

  const resourceLen = reader.u32(offset, false);
  offset += 4;
  const resourceEnd = offset + resourceLen;
  if (!reader.has(offset, resourceLen)) return [];

  const found: ThumbnailCandidate[] = [];
  while (offset + 12 <= resourceEnd) {
    if (
      reader.u8(offset) !== 0x38 || // 8
      reader.u8(offset + 1) !== 0x42 || // B
      reader.u8(offset + 2) !== 0x49 || // I
      reader.u8(offset + 3) !== 0x4d // M
    ) {
      break;
    }
    const id = reader.u16(offset + 4, false);
    const nameLen = reader.u8(offset + 6);
    let cursor = offset + 7 + nameLen;
    if (cursor % 2 !== 0) cursor++;
    if (!reader.has(cursor, 4)) break;
    const size = reader.u32(cursor, false);
    const dataOffset = cursor + 4;
    if (
      (id === RESOURCE_THUMB || id === RESOURCE_THUMB_OLD) &&
      size > THUMB_HEADER &&
      reader.has(dataOffset, size)
    ) {
      const format = reader.u32(dataOffset, false);
      if (format === JPEG_FORMAT) {
        const jpeg =
          extractJpegAt(reader.bytes, dataOffset + THUMB_HEADER) ??
          reader.slice(dataOffset + THUMB_HEADER, size - THUMB_HEADER);
        const candidate = candidateFromImageBytes(jpeg);
        if (candidate) found.push(candidate);
      }
    }
    offset = dataOffset + size;
    if (offset % 2 !== 0) offset++;
  }
  return found;
}
