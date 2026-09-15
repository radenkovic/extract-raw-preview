/** CR2 extractor, driven entirely by fixtures (SPEC §8.3). */

import assert from "node:assert/strict";
import test from "node:test";

import { extractThumbnail, listThumbnails } from "../../dist/index.js";
import { assertCandidatesMatch, filesForFormat, fixturePath } from "../helpers.mjs";

for (const entry of filesForFormat("cr2")) {
  test(`${entry.id}: every embedded preview matches the manifest`, async () => {
    const candidates = await listThumbnails(fixturePath(entry.id));
    assertCandidatesMatch(candidates, entry);
  });
}

test("cr2-canon-40d: the IFD chain yields the preview, the thumbnail and the lossless raw", async () => {
  const candidates = await listThumbnails(fixturePath("cr2-canon-40d"));
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.width}x${candidate.height}`),
    ["3888x2592", "1936x1288", "160x120"],
  );
});

test("cr2-canon-40d: the lossless full-size preview is never selected", async () => {
  const result = await extractThumbnail(fixturePath("cr2-canon-40d"));
  assert.equal(result.found, true);
  assert.equal(result.format, "cr2");
  assert.equal(result.width, 1936);
  assert.equal(result.height, 1288);
  assert.equal(result.byteLength, 365662);
  assert.equal(result.decodable, true);
});

test("cr2-canon-40d: prefer smallest selects the JPEGInterchangeFormat thumbnail", async () => {
  const result = await extractThumbnail(fixturePath("cr2-canon-40d"), {
    prefer: "smallest",
  });
  assert.equal(result.found, true);
  assert.equal(result.width, 160);
  assert.equal(result.height, 120);
  assert.equal(result.byteLength, 8071);
});

test("cr2-canon-40d: the lossless candidate reports the EXIF image size", async () => {
  // IFD3 carries no ImageWidth/ImageLength; its SOF3 describes a 1972x2622
  // slice, so the file-level EXIF size (3888x2592) is the honest answer.
  const [lossless] = await listThumbnails(fixturePath("cr2-canon-40d"));
  assert.equal(lossless.decodable, false);
  assert.equal(lossless.width, 3888);
  assert.equal(lossless.height, 2592);
  assert.equal(lossless.byteLength, 9578955);
});

test("cr2-canon-40d: the lossless preview exceeds the default 8 MiB cap", async () => {
  // 9.1 MiB, so it is filtered out — but it is non-decodable anyway.
  const [lossless] = await listThumbnails(fixturePath("cr2-canon-40d"));
  assert.ok(lossless.byteLength > 8 * 1024 * 1024);
});

test("cr2-canon-40d: a tight maxBytes leaves only the small thumbnail", async () => {
  const result = await extractThumbnail(fixturePath("cr2-canon-40d"), {
    maxBytes: 100_000,
  });
  assert.equal(result.found, true);
  assert.equal(result.width, 160);
  assert.equal(result.height, 120);
});
