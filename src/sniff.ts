/**
 * Magic-byte format detection (SPEC §4.1, §6).
 *
 * Sniffing reads at most the first 64 KiB: enough for every signature here,
 * including the DNG version tag, which lives in IFD0 near the front of the file.
 */

import { findEntry, readIfd, readTiffHeader, Tag } from "./ifd.js";
import { Reader } from "./reader.js";
import type { FormatId } from "./types.js";

/** Upper bound on how much of an input sniffing may look at (SPEC §4.1). */
export const SNIFF_BYTES = 64 * 1024;

export function hasTiffMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const littleEndian = bytes[0] === 0x49 && bytes[1] === 0x49;
  const bigEndian = bytes[0] === 0x4d && bytes[1] === 0x4d;
  if (!littleEndian && !bigEndian) return false;
  const magic = littleEndian
    ? (bytes[2] as number) | ((bytes[3] as number) << 8)
    : ((bytes[2] as number) << 8) | (bytes[3] as number);
  return magic === 42;
}

/** `II*\x00` followed by the CR2 signature `CR\x02\x00` at offset 8. */
export function hasCr2Signature(bytes: Uint8Array): boolean {
  return (
    hasTiffMagic(bytes) &&
    bytes.length >= 11 &&
    bytes[8] === 0x43 && // C
    bytes[9] === 0x52 && // R
    bytes[10] === 0x02
  );
}

/** TIFF magic plus a `DNGVersion` tag in IFD0. */
export function hasDngVersion(bytes: Uint8Array): boolean {
  if (!hasTiffMagic(bytes)) return false;
  try {
    const reader = new Reader(bytes);
    const header = readTiffHeader(reader);
    const ifd = readIfd(reader, header.firstIfdOffset, header.littleEndian);
    return findEntry(ifd, Tag.DNGVersion) !== undefined;
  } catch {
    // IFD0 lies beyond the sniffed prefix, or is malformed.
    return false;
  }
}

/** Returns the detected format, or `undefined` when nothing matches. */
export function sniffFormat(bytes: Uint8Array): FormatId | undefined {
  if (!hasTiffMagic(bytes)) return undefined;
  if (hasCr2Signature(bytes)) return "cr2";
  if (hasDngVersion(bytes)) return "dng";
  return "tiff";
}
