/**
 * Shared TIFF/IFD walker (SPEC §5.4).
 *
 * TIFF-container formats (TIFF, DNG, CR2, NEF, ARW, PEF, ORF, RW2) configure
 * this walker rather than re-implementing it.
 */

import { ExtractError, truncated } from "./errors.js";
import type { Reader } from "./reader.js";

/** TIFF/EXIF/DNG tags this library cares about. */
export const Tag = {
  NewSubfileType: 0x00fe,
  ImageWidth: 0x0100,
  ImageLength: 0x0101,
  Compression: 0x0103,
  Make: 0x010f,
  PhotometricInterpretation: 0x0106,
  StripOffsets: 0x0111,
  StripByteCounts: 0x0117,
  SubIFDs: 0x014a,
  JPEGInterchangeFormat: 0x0201,
  JPEGInterchangeFormatLength: 0x0202,
  ExifIFD: 0x8769,
  DNGVersion: 0xc612,
  ExifImageWidth: 0xa002,
  ExifImageHeight: 0xa003,
} as const;

/** Classic TIFF magic (`42`) plus the TIFF-like RAW variants. */
export const TiffMagic = {
  classic: 42,
  /** Olympus ORF: `MMOR` / `IIRO`. */
  orf: 0x4f52,
  /** Olympus ORF: `IIRS`. */
  orfRs: 0x5352,
  /** Panasonic RW2: `IIU\0`. */
  rw2: 0x55,
} as const;

/** Compression values relevant to embedded previews. */
export const Compression = {
  none: 1,
  ccitt: 2,
  lzw: 5,
  /** Old-style JPEG (tags 0x0201/0x0202, no JPEG tables in the stream). */
  oldJpeg: 6,
  /** New-style JPEG. */
  jpeg: 7,
  deflate: 8,
} as const;

const TYPE_SIZE: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
  13: 4, // IFD
};

export interface TiffHeader {
  littleEndian: boolean;
  firstIfdOffset: number;
  /** True when the CR2 signature (`CR\x02\x00`) sits at offset 8. */
  cr2: boolean;
  /** CR2 only: the raw IFD offset recorded in the canonical header (bytes 12-15). */
  cr2RawIfdOffset?: number;
}

export interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Total size in bytes of the entry's value. */
  byteLength: number;
  /** Absolute offset of the value (inline when it fits in 4 bytes). */
  valueOffset: number;
}

export interface Ifd {
  offset: number;
  entries: readonly IfdEntry[];
  nextOffset: number;
}

function orderName(littleEndian: boolean): string {
  return littleEndian ? "little-endian" : "big-endian";
}

export interface TiffHeaderOptions {
  /** Accepted 16-bit magic values. Defaults to classic TIFF (`42`). */
  magics?: readonly number[];
}

/** Reads and validates a TIFF / TIFF-like header, including the CR2 variant. */
export function readTiffHeader(reader: Reader, options: TiffHeaderOptions = {}): TiffHeader {
  if (!reader.has(0, 8)) {
    throw new ExtractError(
      "ERR_UNRECOGNIZED_FORMAT",
      "input is too short to contain a TIFF header",
    );
  }

  const b0 = reader.u8(0);
  const b1 = reader.u8(1);
  let littleEndian: boolean;
  if (b0 === 0x49 && b1 === 0x49) {
    littleEndian = true;
  } else if (b0 === 0x4d && b1 === 0x4d) {
    littleEndian = false;
  } else {
    throw new ExtractError(
      "ERR_UNRECOGNIZED_FORMAT",
      "input does not start with a TIFF byte-order mark",
    );
  }

  const magics = options.magics ?? [TiffMagic.classic];
  const magic = reader.u16(2, littleEndian);
  if (!magics.includes(magic)) {
    throw new ExtractError(
      "ERR_UNRECOGNIZED_FORMAT",
      `unexpected TIFF magic number ${magic} (expected ${magics.join(" or ")})`,
    );
  }

  const firstIfdOffset = reader.u32(4, littleEndian);
  const cr2 =
    magic === TiffMagic.classic &&
    littleEndian &&
    reader.has(8, 4) &&
    reader.u8(8) === 0x43 && // C
    reader.u8(9) === 0x52 && // R
    reader.u8(10) === 0x02;

  const header: TiffHeader = { littleEndian, firstIfdOffset, cr2 };
  if (cr2 && reader.has(12, 4)) {
    header.cr2RawIfdOffset = reader.u32(12, littleEndian);
  }
  return header;
}

/** Reads one IFD. A malformed or out-of-bounds IFD on a *required* path throws. */
export function readIfd(reader: Reader, offset: number, littleEndian: boolean): Ifd {
  if (!reader.has(offset, 2)) {
    throw truncated(
      `IFD offset ${offset} lies outside the input (${reader.length} byte(s), ${orderName(littleEndian)})`,
    );
  }
  const count = reader.u16(offset, littleEndian);
  const entriesLength = count * 12;
  if (!reader.has(offset + 2, entriesLength + 4)) {
    throw truncated(
      `IFD at offset ${offset} declares ${count} entries, running past the end of the input`,
    );
  }

  const entries: IfdEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = offset + 2 + i * 12;
    const tag = reader.u16(base, littleEndian);
    const type = reader.u16(base + 2, littleEndian);
    const valueCount = reader.u32(base + 4, littleEndian);
    const byteLength = (TYPE_SIZE[type] ?? 0) * valueCount;
    entries.push({
      tag,
      type,
      count: valueCount,
      byteLength,
      valueOffset: byteLength > 4 ? reader.u32(base + 8, littleEndian) : base + 8,
    });
  }

  return {
    offset,
    entries,
    nextOffset: reader.u32(offset + 2 + entriesLength, littleEndian),
  };
}

export function findEntry(ifd: Ifd, tag: number): IfdEntry | undefined {
  return ifd.entries.find((entry) => entry.tag === tag);
}

/**
 * Reads an entry's values as unsigned integers. Returns `[]` when the value is
 * unreadable: callers treat that as "structure absent" (SPEC §5.2).
 */
export function readUintValues(reader: Reader, entry: IfdEntry, littleEndian: boolean): number[] {
  const { count, type, valueOffset } = entry;
  if (count <= 0 || count > 0xffff) return [];

  if (type === 3 || type === 8) {
    if (!reader.has(valueOffset, count * 2)) return [];
    return Array.from({ length: count }, (_, i) => reader.u16(valueOffset + i * 2, littleEndian));
  }
  if (type === 4 || type === 9 || type === 13) {
    if (!reader.has(valueOffset, count * 4)) return [];
    return Array.from({ length: count }, (_, i) => reader.u32(valueOffset + i * 4, littleEndian));
  }
  if (type === 1 || type === 6 || type === 7) {
    if (!reader.has(valueOffset, count)) return [];
    return Array.from({ length: count }, (_, i) => reader.u8(valueOffset + i));
  }
  return [];
}

/** Reads a single tag as an unsigned integer, or `undefined` when absent. */
export function readUint(
  reader: Reader,
  ifd: Ifd,
  tag: number,
  littleEndian: boolean,
): number | undefined {
  const entry = findEntry(ifd, tag);
  if (!entry) return undefined;
  return readUintValues(reader, entry, littleEndian)[0];
}

/**
 * Reads an ASCII (type 2) tag, stripping trailing NUL bytes. Returns
 * `undefined` when the tag is absent or unreadable.
 */
export function readAscii(reader: Reader, ifd: Ifd, tag: number): string | undefined {
  const entry = findEntry(ifd, tag);
  if (!entry) return undefined;
  if (entry.type !== 2 || entry.count < 1) return undefined;
  if (!reader.has(entry.valueOffset, entry.count)) return undefined;
  const bytes = reader.bytes.subarray(entry.valueOffset, entry.valueOffset + entry.count);
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return undefined;
  return new TextDecoder("latin1").decode(bytes.subarray(0, end));
}

/** IFD0 `Make`, used to tell NEF / ARW / PEF apart from generic TIFF. */
export function readIfd0Make(reader: Reader): string | undefined {
  try {
    const header = readTiffHeader(reader);
    const ifd = readIfd(reader, header.firstIfdOffset, header.littleEndian);
    return readAscii(reader, ifd, Tag.Make);
  } catch {
    return undefined;
  }
}

export interface IfdWalkOptions {
  /** Additional IFD-pointer tags to follow (e.g. `SubIFDs`). */
  pointerTags?: readonly number[];
  /** Safety bound on the number of IFDs visited. */
  maxIfds?: number;
  /** Safety bound on chain/pointer depth, which also breaks pointer cycles. */
  maxDepth?: number;
}

/**
 * Walks the IFD graph breadth-first from `seeds`, following next-IFD links and
 * the configured pointer tags. Cycles are broken by offset; malformed branches
 * are dropped rather than thrown so one bad pointer cannot hide a good preview.
 */
export function walkIfds(
  reader: Reader,
  littleEndian: boolean,
  seeds: readonly number[],
  options: IfdWalkOptions = {},
): Ifd[] {
  const pointerTags = options.pointerTags ?? [];
  const maxIfds = options.maxIfds ?? 64;
  const maxDepth = options.maxDepth ?? 8;

  const visited = new Set<number>();
  const found: Ifd[] = [];
  const queue: Array<{ offset: number; depth: number }> = seeds
    .filter((offset) => offset > 0)
    .map((offset) => ({ offset, depth: 0 }));

  while (queue.length > 0 && found.length < maxIfds) {
    const current = queue.shift();
    if (!current) break;
    const { offset, depth } = current;
    if (depth > maxDepth || visited.has(offset) || !reader.has(offset, 2)) continue;
    visited.add(offset);

    let ifd: Ifd;
    try {
      ifd = readIfd(reader, offset, littleEndian);
    } catch (error) {
      // The IFDs a walk is seeded with are *required* structures, so a bounds
      // violation there means the container is truncated (SPEC §5.2). Anything
      // further in is probed, and a bad pointer is treated as structure absent.
      if (depth === 0) throw error;
      continue;
    }
    found.push(ifd);

    const next: number[] = [ifd.nextOffset];
    for (const tag of pointerTags) {
      const entry = findEntry(ifd, tag);
      if (entry) next.push(...readUintValues(reader, entry, littleEndian));
    }
    for (const child of next) {
      if (child > 0 && !visited.has(child)) {
        queue.push({ offset: child, depth: depth + 1 });
      }
    }
  }

  return found;
}

/**
 * Resolves the file-level EXIF image dimensions (`ExifImageWidth` /
 * `ExifImageHeight`, tags 0xA002/0xA003).
 *
 * These describe the main image rather than any single IFD, and they are the
 * only dimension source for containers whose raw IFD carries no
 * `ImageWidth`/`ImageLength` — notably CR2, where the raw image is stored as a
 * multi-slice lossless JPEG whose own frame header describes a slice, not the
 * image. See SPEC §6.
 */
export function readExifImageSize(
  reader: Reader,
  littleEndian: boolean,
  ifd: Ifd | undefined,
): { width: number; height: number } | undefined {
  if (!ifd) return undefined;
  const pointer = findEntry(ifd, Tag.ExifIFD);
  if (!pointer) return undefined;
  const exifOffset = readUintValues(reader, pointer, littleEndian)[0];
  if (exifOffset === undefined || !reader.has(exifOffset, 2)) return undefined;

  let exifIfd: Ifd;
  try {
    exifIfd = readIfd(reader, exifOffset, littleEndian);
  } catch {
    return undefined;
  }

  const width = readUint(reader, exifIfd, Tag.ExifImageWidth, littleEndian);
  const height = readUint(reader, exifIfd, Tag.ExifImageHeight, littleEndian);
  if (width === undefined || height === undefined || width <= 0 || height <= 0) {
    return undefined;
  }
  return { width, height };
}
