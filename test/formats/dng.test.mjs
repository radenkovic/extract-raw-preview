/** DNG extractor, driven entirely by fixtures (SPEC §8.3). */

import assert from "node:assert/strict";
import test from "node:test";

import { extractThumbnail, listThumbnails } from "../../dist/index.js";
import { assertCandidatesMatch, filesForFormat, fixturePath } from "../helpers.mjs";

for (const entry of filesForFormat("dng")) {
  test(`${entry.id}: every embedded preview matches the manifest`, async () => {
    const candidates = await listThumbnails(fixturePath(entry.id));
    assertCandidatesMatch(candidates, entry);
  });
}

test("dng-canon-5d3-lossy: nested SubIFD previews are all found", async () => {
  const candidates = await listThumbnails(fixturePath("dng-canon-5d3-lossy"));
  assert.deepEqual(
    candidates.map((candidate) => `${candidate.width}x${candidate.height}`),
    ["5760x3840", "1024x683", "256x171"],
  );
});

test("dng-canon-5d3-lossy: selects the largest preview by default", async () => {
  const result = await extractThumbnail(fixturePath("dng-canon-5d3-lossy"));
  assert.equal(result.found, true);
  assert.equal(result.format, "dng");
  assert.equal(result.width, 5760);
  assert.equal(result.height, 3840);
  assert.equal(result.byteLength, 1235564);
  assert.equal(result.decodable, true);
});

test("dng-canon-5d3-lossy: prefer smallest selects the 256x171 preview", async () => {
  const result = await extractThumbnail(fixturePath("dng-canon-5d3-lossy"), {
    prefer: "smallest",
  });
  assert.equal(result.found, true);
  assert.equal(result.width, 256);
  assert.equal(result.height, 171);
  assert.equal(result.byteLength, 11034);
});

test("dng-canon-5d3-lossy: 34892 JPEG XL sub-images are not previews", async () => {
  // SubIFD0 of this file is compression 34892 (JPEG XL), which v0.1 ignores.
  const candidates = await listThumbnails(fixturePath("dng-canon-5d3-lossy"));
  const isJpegXl = candidates.some(
    (candidate) =>
      candidate.width === 5760 && candidate.height === 3840 && candidate.byteLength === 0,
  );
  assert.equal(isJpegXl, false);
  assert.equal(candidates.length, 3);
});
