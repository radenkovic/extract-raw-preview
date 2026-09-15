/**
 * Canon CR3 extractor (SPEC §6).
 *
 * CR3 is an ISO BMFF (`ftyp` brand `crx `) file. Preview JPEGs live in a `THMB`
 * box, a Canon `uuid` preview box, and often at the start of `mdat`. Each JPEG
 * is copied as stored; nested EXIF thumbnails are collected too.
 */

import { walkBmff } from "../bmff.js";
import { extractJpegAt } from "../jpeg.js";
import type { Reader } from "../reader.js";
import { sniffFormat } from "../sniff.js";
import type { ThumbnailCandidate } from "../types.js";
import { candidateFromImageBytes, extractJpegExifPreviews, uniqueCandidates } from "./shared.js";

/** How far into a box payload we look for a JPEG SOI. */
const JPEG_SCAN = 64;

function jpegInPayload(bytes: Uint8Array, start: number, length: number): Uint8Array | undefined {
  const limit = Math.min(start + JPEG_SCAN, start + length, bytes.length - 2);
  for (let i = start; i < limit; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      const jpeg = extractJpegAt(bytes, i);
      if (jpeg) return jpeg;
    }
  }
  return undefined;
}

export function matches(bytes: Uint8Array): boolean {
  return sniffFormat(bytes) === "cr3";
}

export async function extract(reader: Reader): Promise<ThumbnailCandidate[]> {
  const found: ThumbnailCandidate[] = [];
  for (const box of walkBmff(reader)) {
    if (box.payloadLength < 3) continue;
    const jpeg = jpegInPayload(reader.bytes, box.payloadOffset, box.payloadLength);
    if (!jpeg) continue;
    const candidate = candidateFromImageBytes(jpeg);
    if (candidate) found.push(candidate);
    found.push(...extractJpegExifPreviews(jpeg));
  }
  return uniqueCandidates(found);
}
