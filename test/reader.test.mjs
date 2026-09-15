/** Reader tests cover bounds violations -> ERR_TRUNCATED (SPEC §8.3). */

import assert from "node:assert/strict";
import test from "node:test";

import { Reader } from "../dist/index.js";

const isTruncated = (error) => error.code === "ERR_TRUNCATED";

test("slice past the end throws ERR_TRUNCATED", () => {
  const reader = new Reader(new Uint8Array([1, 2, 3, 4]));
  assert.throws(() => reader.slice(3, 5), isTruncated);
  assert.throws(() => reader.slice(9, 1), isTruncated);
  assert.equal(reader.slice(4, 0).length, 0); // a zero-length read at the end is fine
});

test("seek and read past the end throw ERR_TRUNCATED", () => {
  const reader = new Reader(new Uint8Array(4));
  assert.throws(() => reader.seek(5), isTruncated);
  assert.throws(() => reader.seek(-1), isTruncated);
  reader.seek(3);
  assert.throws(() => reader.read(2), isTruncated);
});

test("fixed-width reads past the end throw ERR_TRUNCATED", () => {
  const reader = new Reader(new Uint8Array([0, 1, 2]));
  assert.throws(() => reader.u16(2, true), isTruncated);
  assert.throws(() => reader.u32(0, true), isTruncated);
  assert.equal(reader.u8(2), 2);
});

test("has() reports bounds without throwing", () => {
  const reader = new Reader(new Uint8Array(4));
  assert.equal(reader.has(0, 4), true);
  assert.equal(reader.has(1, 4), false);
  assert.equal(reader.has(-1, 1), false);
  assert.equal(reader.has(0, 0), true);
});

test("read advances the cursor and returns a copy", () => {
  const reader = new Reader(new Uint8Array([1, 2, 3, 4]));
  const first = reader.read(2);
  assert.deepEqual([...first], [1, 2]);
  assert.equal(reader.position, 2);
  assert.deepEqual([...reader.read(2)], [3, 4]);
  assert.equal(reader.position, 4);
});

test("slice returns a copy, never a view into the source", () => {
  const source = new Uint8Array([1, 2, 3, 4, 5]);
  const reader = new Reader(source);
  const copy = reader.slice(1, 3);
  source.fill(9);
  assert.deepEqual([...copy], [2, 3, 4]);
});

test("Buffer input cannot leak a view through slice", () => {
  // Buffer.prototype.slice returns a view; Reader must not inherit that.
  const source = Buffer.from([1, 2, 3, 4]);
  const copy = new Reader(source).slice(0, 4);
  assert.notEqual(copy.buffer, source.buffer);
  source.fill(0);
  assert.deepEqual([...copy], [1, 2, 3, 4]);
});

test("unsigned reads respect byte order", () => {
  const reader = new Reader(new Uint8Array([0x12, 0x34, 0x56, 0x78]));
  assert.equal(reader.u16(0, true), 0x3412);
  assert.equal(reader.u16(0, false), 0x1234);
  assert.equal(reader.u32(0, true), 0x78563412);
  assert.equal(reader.u32(0, false), 0x12345678);
});
