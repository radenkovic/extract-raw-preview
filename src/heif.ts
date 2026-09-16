/**
 * HEIF item parser (ISO/IEC 23008-12).
 *
 * Copies JPEG/PNG image items and EXIF IFD1 thumbnails when they are stored
 * as-is. Callers fall back to decode+re-encode when this returns nothing.
 */

import { walkBmff } from "./bmff.js";
import {
  candidateFromImageBytes,
  extractTiffPreviews,
  uniqueCandidates,
} from "./formats/shared.js";
import { looksLikeJpeg, looksLikePng } from "./jpeg.js";
import { Reader } from "./reader.js";
import type { ThumbnailCandidate } from "./types.js";

interface HeifItem {
  id: number;
  type: string;
  contentType?: string;
}

function readCString(
  bytes: Uint8Array,
  offset: number,
  end: number,
): { value: string; next: number } {
  let i = offset;
  while (i < end && bytes[i] !== 0) i++;
  return {
    value: String.fromCharCode(...bytes.subarray(offset, i)),
    next: Math.min(i + 1, end),
  };
}

function readSized(reader: Reader, offset: number, size: number): { value: number; next: number } {
  if (size === 0) return { value: 0, next: offset };
  if (size === 4) return { value: reader.u32(offset, false), next: offset + 4 };
  if (size === 8) {
    const hi = reader.u32(offset, false);
    const lo = reader.u32(offset + 4, false);
    if (hi !== 0) return { value: 0, next: offset + 8 };
    return { value: lo, next: offset + 8 };
  }
  return { value: 0, next: offset };
}

function parseInfe(
  reader: Reader,
  payloadOffset: number,
  payloadLength: number,
): HeifItem | undefined {
  if (payloadLength < 8) return undefined;
  const version = reader.u8(payloadOffset);
  let offset = payloadOffset + 4;
  const end = payloadOffset + payloadLength;
  let id: number;
  if (version >= 3) {
    if (offset + 8 > end) return undefined;
    id = reader.u32(offset, false);
    offset += 6; // id + protection
  } else if (version >= 2) {
    if (offset + 8 > end) return undefined;
    id = reader.u16(offset, false);
    offset += 4; // id + protection
  } else {
    return undefined;
  }
  if (offset + 4 > end) return undefined;
  const type = String.fromCharCode(
    reader.u8(offset),
    reader.u8(offset + 1),
    reader.u8(offset + 2),
    reader.u8(offset + 3),
  );
  offset += 4;
  const name = readCString(reader.bytes, offset, end);
  offset = name.next;
  let contentType: string | undefined;
  if (type === "mime" && offset < end) {
    contentType = readCString(reader.bytes, offset, end).value;
  }
  return { id, type, contentType };
}

function parseIinf(reader: Reader, payloadOffset: number, payloadLength: number): HeifItem[] {
  if (payloadLength < 6) return [];
  const version = reader.u8(payloadOffset);
  let offset = payloadOffset + 4;
  const end = payloadOffset + payloadLength;
  const count = version === 0 ? reader.u16(offset, false) : reader.u32(offset, false);
  offset += version === 0 ? 2 : 4;
  const items: HeifItem[] = [];
  for (let i = 0; i < count && offset + 8 <= end; i++) {
    const size = reader.u32(offset, false);
    const type = String.fromCharCode(
      reader.u8(offset + 4),
      reader.u8(offset + 5),
      reader.u8(offset + 6),
      reader.u8(offset + 7),
    );
    if (size < 8 || offset + size > end) break;
    if (type === "infe") {
      const item = parseInfe(reader, offset + 8, size - 8);
      if (item) items.push(item);
    }
    offset += size;
  }
  return items;
}

function parseIloc(
  reader: Reader,
  payloadOffset: number,
  payloadLength: number,
  idatOffset: number | undefined,
): Map<number, { offset: number; length: number }> {
  const locations = new Map<number, { offset: number; length: number }>();
  if (payloadLength < 8) return locations;
  const version = reader.u8(payloadOffset);
  const packed = reader.u8(payloadOffset + 4);
  const offsetSize = packed >> 4;
  const lengthSize = packed & 0x0f;
  const packed2 = reader.u8(payloadOffset + 5);
  const baseOffsetSize = packed2 >> 4;
  const indexSize = version === 1 || version === 2 ? packed2 & 0x0f : 0;
  let offset = payloadOffset + 6;
  const end = payloadOffset + payloadLength;
  const itemCount = version < 2 ? reader.u16(offset, false) : reader.u32(offset, false);
  offset += version < 2 ? 2 : 4;

  for (let i = 0; i < itemCount && offset < end; i++) {
    const itemId = version < 2 ? reader.u16(offset, false) : reader.u32(offset, false);
    offset += version < 2 ? 2 : 4;
    let construction = 0;
    if (version === 1 || version === 2) {
      construction = reader.u16(offset, false) & 0x0f;
      offset += 2;
    }
    offset += 2; // data_reference_index
    const base = readSized(reader, offset, baseOffsetSize);
    offset = base.next;
    if (offset + 2 > end) break;
    const extentCount = reader.u16(offset, false);
    offset += 2;
    let firstOffset = 0;
    let total = 0;
    for (let j = 0; j < extentCount && offset < end; j++) {
      if (indexSize) offset = readSized(reader, offset, indexSize).next;
      const extentOffset = readSized(reader, offset, offsetSize);
      offset = extentOffset.next;
      const extentLength = readSized(reader, offset, lengthSize);
      offset = extentLength.next;
      if (j === 0) firstOffset = base.value + extentOffset.value;
      total += extentLength.value;
    }
    const absolute =
      construction === 1 && idatOffset !== undefined ? idatOffset + firstOffset : firstOffset;
    if (total > 0) locations.set(itemId, { offset: absolute, length: total });
  }
  return locations;
}

function isJpegItem(item: HeifItem): boolean {
  return item.type === "jpeg" || item.contentType === "image/jpeg";
}

function isPngItem(item: HeifItem): boolean {
  return item.contentType === "image/png";
}

function isExifItem(item: HeifItem): boolean {
  return item.type === "Exif";
}

function payloadLooksLikeTiff(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49) || (bytes[0] === 0x4d && bytes[1] === 0x4d))
  );
}

function extractExifPreviews(bytes: Uint8Array): ThumbnailCandidate[] {
  let tiff = bytes;
  if (bytes.length >= 8 && !payloadLooksLikeTiff(bytes)) {
    const declared =
      ((bytes[0] as number) << 24) |
      ((bytes[1] as number) << 16) |
      ((bytes[2] as number) << 8) |
      (bytes[3] as number);
    const start = 4 + declared;
    if (start < bytes.length && payloadLooksLikeTiff(bytes.subarray(start))) {
      tiff = bytes.subarray(start);
    } else if (payloadLooksLikeTiff(bytes.subarray(4))) {
      tiff = bytes.subarray(4);
    } else {
      return [];
    }
  }
  try {
    return extractTiffPreviews(new Reader(tiff));
  } catch {
    return [];
  }
}

/** Stored JPEG/PNG previews inside a HEIF/AVIF file, if any. */
export function extractStoredHeifPreviews(reader: Reader): ThumbnailCandidate[] {
  const boxes = walkBmff(reader);
  const iinf = boxes.find((box) => box.type === "iinf");
  const iloc = boxes.find((box) => box.type === "iloc");
  const idat = boxes.find((box) => box.type === "idat");
  if (!iinf || !iloc) return [];

  let items: HeifItem[];
  let locations: Map<number, { offset: number; length: number }>;
  try {
    items = parseIinf(reader, iinf.payloadOffset, iinf.payloadLength);
    locations = parseIloc(reader, iloc.payloadOffset, iloc.payloadLength, idat?.payloadOffset);
  } catch {
    return [];
  }

  const found: ThumbnailCandidate[] = [];
  for (const item of items) {
    const loc = locations.get(item.id);
    if (!loc || !reader.has(loc.offset, loc.length)) continue;
    const payload = reader.slice(loc.offset, loc.length);

    if (isJpegItem(item) || looksLikeJpeg(payload)) {
      const candidate = candidateFromImageBytes(payload);
      if (candidate) found.push(candidate);
      continue;
    }
    if (isPngItem(item) || looksLikePng(payload)) {
      const candidate = candidateFromImageBytes(payload);
      if (candidate) found.push(candidate);
      continue;
    }
    if (isExifItem(item) || item.type === "Exif") {
      found.push(...extractExifPreviews(payload));
    }
  }
  return uniqueCandidates(found);
}
