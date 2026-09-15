/**
 * Minimal ISO BMFF box walker for CR3 (and similar `ftyp` containers).
 *
 * Only container boxes are recursed into. `mdat` is reported but not walked,
 * so a compressed raw payload cannot hide extra false-positive JPEGs.
 */

import type { Reader } from "./reader.js";

export interface BmffBox {
  type: string;
  /** Absolute offset of the 4-byte size field. */
  offset: number;
  /** Total box size, including the header. */
  size: number;
  headerSize: number;
  payloadOffset: number;
  payloadLength: number;
}

const CONTAINERS = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "dinf",
  "udta",
  "meta",
  "iprp",
  "ipco",
  "uuid",
  "CRAW",
]);

function fourcc(reader: Reader, offset: number): string {
  return String.fromCharCode(
    reader.u8(offset),
    reader.u8(offset + 1),
    reader.u8(offset + 2),
    reader.u8(offset + 3),
  );
}

/**
 * Walks `[start, end)` as a sequence of boxes. Malformed tails are dropped
 * rather than thrown — CR3 still yields its thumbnail boxes when `mdat` is
 * truncated.
 */
export function walkBmff(
  reader: Reader,
  start = 0,
  end: number = reader.length,
  depth = 0,
): BmffBox[] {
  const boxes: BmffBox[] = [];
  if (depth > 8) return boxes;
  let offset = start;
  let n = 0;
  while (offset + 8 <= end && n < 256) {
    const size32 = reader.u32(offset, false);
    const type = fourcc(reader, offset + 4);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      if (offset + 16 > end) break;
      const hi = reader.u32(offset + 8, false);
      const lo = reader.u32(offset + 12, false);
      if (hi !== 0) break; // larger than we address with 32-bit offsets
      size = lo;
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) break;

    const payloadOffset = offset + headerSize;
    const payloadLength = size - headerSize;
    boxes.push({ type, offset, size, headerSize, payloadOffset, payloadLength });

    if (CONTAINERS.has(type) && payloadLength > 0) {
      let inner = payloadOffset;
      if (type === "meta" && payloadLength >= 4) inner += 4;
      if (type === "uuid" && payloadLength >= 16) inner += 16;
      if (inner < offset + size) {
        boxes.push(...walkBmff(reader, inner, offset + size, depth + 1));
      }
    }

    offset += size;
    n++;
  }
  return boxes;
}
