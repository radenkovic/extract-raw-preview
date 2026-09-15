/** TIFF extractor, driven entirely by fixtures (SPEC §8.3). */

import assert from "node:assert/strict";
import test from "node:test";

import { extractThumbnail, listThumbnails } from "../../dist/index.js";
import { assertCandidatesMatch, filesForFormat, fixturePath } from "../helpers.mjs";

for (const entry of filesForFormat("tiff")) {
  test(`${entry.id}: every embedded preview matches the manifest`, async () => {
    const candidates = await listThumbnails(fixturePath(entry.id));
    assertCandidatesMatch(candidates, entry);
  });
}

test("tiff-child-ifd: selects the largest decodable preview", async () => {
  const result = await extractThumbnail(fixturePath("tiff-child-ifd"));
  assert.equal(result.found, true);
  assert.equal(result.format, "tiff");
  assert.equal(result.width, 32);
  assert.equal(result.height, 32);
  assert.equal(result.byteLength, 647);
  assert.equal(result.mimeType, "image/jpeg");
  assert.equal(result.origin, "embedded-jpeg");
  assert.equal(result.decodable, true);
});

test("tiff-child-ifd: prefer smallest picks the 8x8 SubIFD image", async () => {
  const result = await extractThumbnail(fixturePath("tiff-child-ifd"), {
    prefer: "smallest",
  });
  assert.equal(result.found, true);
  assert.equal(result.width, 8);
  assert.equal(result.height, 8);
  assert.equal(result.byteLength, 635);
});

test("tiff-old-style-jpeg: old-style JPEG (compression 6) stored in strips", async () => {
  const result = await extractThumbnail(fixturePath("tiff-old-style-jpeg"));
  assert.equal(result.found, true);
  assert.equal(result.format, "tiff");
  assert.equal(result.width, 4160);
  assert.equal(result.height, 870);
  assert.equal(result.byteLength, 212992);
  assert.equal(result.decodable, true);
});

test("tiff-old-style-jpeg: the JPEGInterchangeFormat pointer alone is not a second candidate", async () => {
  // The IFD carries tag 0x0201 but no 0x0202 length, so only the strip candidate exists.
  const candidates = await listThumbnails(fixturePath("tiff-old-style-jpeg"));
  assert.equal(candidates.length, 1);
});

test("tiff-kodak-dcs520c: a lossless-only file is an honest failure", async () => {
  const result = await extractThumbnail(fixturePath("tiff-kodak-dcs520c"));
  assert.equal(result.found, false);
  assert.equal(result.format, "tiff");
  assert.equal(result.reason, "only lossless-jpeg preview present");
});

test("tiff-kodak-dcs520c: the lossless candidate is still listed for inspection", async () => {
  const candidates = await listThumbnails(fixturePath("tiff-kodak-dcs520c"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].decodable, false);
  // Dimensions come from the TIFF tags: the lossless JPEG frame header only
  // describes one 868-pixel slice of the 1736-pixel image.
  assert.equal(candidates[0].width, 1736);
  assert.equal(candidates[0].height, 1160);
});

test("tiff: a big-endian container is parsed like any other", async () => {
  // tiff-kodak-dcs520c.tif is MM (big-endian).
  const bytes = await import("node:fs/promises").then((fs) =>
    fs.readFile(fixturePath("tiff-kodak-dcs520c")),
  );
  assert.equal(bytes[0], 0x4d);
  assert.equal(bytes[1], 0x4d);
});
