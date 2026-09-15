/**
 * Minimal embedded-image inspection: identify the bytes and read the frame
 * header. Nothing here decodes pixels (SPEC §9.4) — we only need the MIME type,
 * the frame dimensions and whether a standard decoder could open the stream.
 */

import type { EmbeddedImageKind, PreviewMimeType } from "./types.js";

export interface ImageInfo {
  mimeType: PreviewMimeType;
  kind: EmbeddedImageKind;
  width: number;
  height: number;
  decodable: boolean;
}

export const PNG_SIGNATURE = Object.freeze([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
] as const);

export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

export function looksLikePng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/** SOF markers that carry frame dimensions. */
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * Markers a standard decoder can open. SOF3 (lossless) — used by the Kodak
 * DCS520C preview and the CR2 IFD3 full-size preview — is deliberately excluded,
 * as are the differential and arithmetic-lossless variants (SPEC §6).
 */
const DECODABLE_MARKERS = new Set([0xc0, 0xc1, 0xc2]);

function kindOfSof(marker: number): EmbeddedImageKind {
  if (marker === 0xc0 || marker === 0xc1) return "baseline-jpeg";
  if (marker === 0xc2) return "progressive-jpeg";
  if (marker === 0xc3) return "lossless-jpeg";
  return "other-jpeg";
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number);
}

/**
 * Walks JPEG markers up to the first SOF, which always precedes entropy-coded
 * data. Returns zeroed dimensions when no SOF is reachable (a truncated or
 * corrupt stream), which callers treat as "not decodable".
 */
export function inspectJpeg(bytes: Uint8Array): ImageInfo {
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1] as number;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // Start of scan (no SOF seen) or end of image.
    if (marker === 0xda || marker === 0xd9) break;

    const segmentLength = u16be(bytes, i + 2);
    if (segmentLength < 2) break;

    if (SOF_MARKERS.has(marker)) {
      if (i + 9 > bytes.length) break;
      return {
        mimeType: "image/jpeg",
        kind: kindOfSof(marker),
        height: u16be(bytes, i + 5),
        width: u16be(bytes, i + 7),
        decodable: DECODABLE_MARKERS.has(marker),
      };
    }
    i += 2 + segmentLength;
  }

  return {
    mimeType: "image/jpeg",
    kind: "other-jpeg",
    width: 0,
    height: 0,
    decodable: false,
  };
}

export function inspectPng(bytes: Uint8Array): ImageInfo {
  // IHDR must be the first chunk: 8-byte signature, 4-byte length, 4-byte type.
  const hasIhdr =
    bytes.length >= 33 &&
    bytes[12] === 0x49 && // I
    bytes[13] === 0x48 && // H
    bytes[14] === 0x44 && // D
    bytes[15] === 0x52; // R
  if (!hasIhdr) {
    return { mimeType: "image/png", kind: "png", width: 0, height: 0, decodable: false };
  }
  const width =
    ((bytes[16] as number) << 24) |
    ((bytes[17] as number) << 16) |
    ((bytes[18] as number) << 8) |
    (bytes[19] as number);
  const height =
    ((bytes[20] as number) << 24) |
    ((bytes[21] as number) << 16) |
    ((bytes[22] as number) << 8) |
    (bytes[23] as number);
  return {
    mimeType: "image/png",
    kind: "png",
    width: width >>> 0,
    height: height >>> 0,
    decodable: true,
  };
}

/** Identifies an embedded preview by content, not by container metadata. */
export function inspectImage(bytes: Uint8Array): ImageInfo | undefined {
  if (looksLikeJpeg(bytes)) return inspectJpeg(bytes);
  if (looksLikePng(bytes)) return inspectPng(bytes);
  return undefined;
}

/**
 * Byte length of a complete JPEG starting at `bytes[0]`, including the EOI
 * marker. APP bodies are skipped by their declared length so an EXIF thumbnail
 * nested in APP1 cannot truncate the outer stream. Returns `undefined` when no
 * EOI is reachable.
 */
export function jpegByteLength(bytes: Uint8Array): number | undefined {
  if (!looksLikeJpeg(bytes) || bytes.length < 4) return undefined;
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1] as number;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd9) return i + 2;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      if (i + 3 >= bytes.length) return undefined;
      const segmentLength = u16be(bytes, i + 2);
      if (segmentLength < 2) return undefined;
      i += 2 + segmentLength;
      while (i + 1 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const scanMarker = bytes[i + 1] as number;
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          i += 2;
          continue;
        }
        if (scanMarker === 0xff) {
          i++;
          continue;
        }
        if (scanMarker === 0xd9) return i + 2;
        i++;
      }
      return undefined;
    }
    if (i + 3 >= bytes.length) return undefined;
    const segmentLength = u16be(bytes, i + 2);
    if (segmentLength < 2) return undefined;
    i += 2 + segmentLength;
  }
  return undefined;
}

/** Copy of the JPEG at `offset`, or `undefined` when no complete stream is there. */
export function extractJpegAt(bytes: Uint8Array, offset: number): Uint8Array | undefined {
  if (offset < 0 || offset >= bytes.length) return undefined;
  const length = jpegByteLength(bytes.subarray(offset));
  if (length === undefined) return undefined;
  return new Uint8Array(bytes.subarray(offset, offset + length));
}

/**
 * TIFF payload of the first APP1 `Exif\0\0` segment, or `undefined`. Offsets
 * inside the returned bytes are relative to the TIFF header, as EXIF requires.
 */
export function findExifTiff(bytes: Uint8Array): Uint8Array | undefined {
  if (!looksLikeJpeg(bytes)) return undefined;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1] as number;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const segmentLength = u16be(bytes, i + 2);
    if (segmentLength < 2) break;
    const payloadStart = i + 4;
    const payloadLength = segmentLength - 2;
    if (
      marker === 0xe1 &&
      payloadLength >= 8 &&
      payloadStart + payloadLength <= bytes.length &&
      bytes[payloadStart] === 0x45 && // E
      bytes[payloadStart + 1] === 0x78 && // x
      bytes[payloadStart + 2] === 0x69 && // i
      bytes[payloadStart + 3] === 0x66 && // f
      bytes[payloadStart + 4] === 0x00 &&
      bytes[payloadStart + 5] === 0x00
    ) {
      return bytes.subarray(payloadStart + 6, payloadStart + payloadLength);
    }
    i += 2 + segmentLength;
  }
  return undefined;
}
