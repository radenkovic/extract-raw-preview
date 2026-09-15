/**
 * Sniffing tests use minimal synthetic byte strings, not full fixtures
 * (SPEC §8.3). `detectFormat` is exercised directly: it accepts raw bytes and
 * reads at most the first 64 KiB.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { detectFormat } from "../dist/index.js";
import { fixturePath } from "./helpers.mjs";

const hex = (text) => Uint8Array.from(text.match(/../g).map((byte) => parseInt(byte, 16)));

test("detects a classic TIFF header in both byte orders", async () => {
  assert.equal(await detectFormat(hex("49492a000800000000000000")), "tiff"); // II*\0
  assert.equal(await detectFormat(hex("4d4d002a0000000800000000")), "tiff"); // MM\0*
});

test("detects the CR2 signature at offset 8", async () => {
  assert.equal(await detectFormat(hex("49492a00100000004352020058a50000")), "cr2");
});

test("detects DNG by the DNGVersion tag in IFD0", async () => {
  // II*\0, IFD0 @8, one entry: tag 0xC612 (DNGVersion) SHORT[4] = 1.4.0.0
  const dng = hex("49492a00080000000100" + "12c6010004000000" + "00040100" + "00000000");
  assert.equal(await detectFormat(dng), "dng");
});

test("a TIFF without DNGVersion is not a DNG", async () => {
  const plain = hex("49492a00080000000100" + "0001010004000000" + "01000000" + "00000000");
  assert.equal(await detectFormat(plain), "tiff");
});

test("returns undefined for bytes with no known signature", async () => {
  assert.equal(await detectFormat(hex("0000000000000000")), undefined);
  assert.equal(await detectFormat(hex("89504e470d0a1a0a")), undefined); // PNG
  assert.equal(await detectFormat(new Uint8Array(0)), undefined);
  assert.equal(await detectFormat(hex("4949")), undefined); // too short for a header
});

test("rejects a TIFF byte-order mark with the wrong magic number", async () => {
  assert.equal(await detectFormat(hex("49492b000800000000000000")), undefined);
});

test("sniffs real fixtures without needing the whole file", async () => {
  assert.equal(await detectFormat(fixturePath("tiff-child-ifd")), "tiff");
  assert.equal(await detectFormat(fixturePath("dng-canon-5d3-lossy")), "dng");
  // 10.4 MiB file: detection still only reads the head.
  assert.equal(await detectFormat(fixturePath("cr2-canon-40d")), "cr2");
});
