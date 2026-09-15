/**
 * Bounded cursor over a byte buffer (SPEC §5.2).
 *
 * Extractors skip to structures by absolute offset rather than walking the
 * container linearly. Bounds violations on *required* structures throw
 * `ERR_TRUNCATED`; callers probing *optional* structures use `has()` (or catch)
 * and treat the structure as absent.
 */

import { truncated } from "./errors.js";

export class Reader {
  readonly bytes: Uint8Array;

  #position = 0;
  #view: DataView | undefined;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  get length(): number {
    return this.bytes.length;
  }

  get position(): number {
    return this.#position;
  }

  /** True when `[offset, offset + length)` lies inside the buffer. */
  has(offset: number, length = 1): boolean {
    return (
      Number.isInteger(offset) &&
      Number.isInteger(length) &&
      offset >= 0 &&
      length >= 0 &&
      offset + length <= this.bytes.length
    );
  }

  /** Moves the cursor to an absolute offset. */
  seek(offset: number): this {
    this.#require(offset, 0, "seek target");
    this.#position = offset;
    return this;
  }

  /** Reads `n` bytes at the cursor, advancing it. Returns a copy. */
  read(n: number): Uint8Array {
    const out = this.slice(this.#position, n);
    this.#position += n;
    return out;
  }

  /**
   * Returns a copy of `[offset, offset + length)`.
   *
   * This always allocates (SPEC §3.1): `Uint8Array.prototype.slice` is
   * deliberately not used because `Buffer` overrides it to return a view, which
   * would keep an entire 40 MB RAW alive for the lifetime of the thumbnail.
   */
  slice(offset: number, length: number): Uint8Array {
    this.#require(offset, length, "slice");
    return new Uint8Array(this.bytes.subarray(offset, offset + length));
  }

  u8(offset: number): number {
    this.#require(offset, 1, "uint8");
    return this.bytes[offset] as number;
  }

  u16(offset: number, littleEndian: boolean): number {
    this.#require(offset, 2, "uint16");
    return this.#dataView().getUint16(offset, littleEndian);
  }

  u32(offset: number, littleEndian: boolean): number {
    this.#require(offset, 4, "uint32");
    return this.#dataView().getUint32(offset, littleEndian);
  }

  #dataView(): DataView {
    this.#view ??= new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );
    return this.#view;
  }

  #require(offset: number, length: number, what: string): void {
    if (!this.has(offset, length)) {
      throw truncated(
        `${what} at offset ${offset} (${length} byte(s)) runs past the end of the input (${this.bytes.length} byte(s))`,
      );
    }
  }
}
