/** Newly shipped formats, driven entirely by fixtures (SPEC §8.3). */

import assert from "node:assert/strict";
import test from "node:test";

import { detectFormat, extractThumbnail, listThumbnails } from "../../dist/index.js";
import { assertCandidatesMatch, filesForFormat, fixturePath } from "../helpers.mjs";

const FORMATS = ["jpeg", "nef", "arw", "raf", "orf", "rw2", "pef", "cr3", "psd", "psb"];

for (const format of FORMATS) {
  for (const entry of filesForFormat(format)) {
    test(`${entry.id}: detectFormat`, async () => {
      assert.equal(await detectFormat(fixturePath(entry.id)), format);
    });

    test(`${entry.id}: every embedded preview matches the manifest`, async () => {
      const candidates = await listThumbnails(fixturePath(entry.id));
      assertCandidatesMatch(candidates, entry);
    });

    test(`${entry.id}: extractThumbnail returns the largest decodable preview`, async () => {
      const result = await extractThumbnail(fixturePath(entry.id));
      assert.equal(result.found, true);
      assert.equal(result.format, format);
      const expected = [...entry.previews]
        .filter((preview) => preview.decodable)
        .sort((a, b) => b.width * b.height - a.width * a.height || b.bytes - a.bytes)[0];
      assert.equal(result.width, expected.width);
      assert.equal(result.height, expected.height);
      assert.equal(result.byteLength, expected.bytes);
      assert.equal(result.decodable, true);
    });
  }
}

test("jpeg-flower: the primary image is not listed as a preview", async () => {
  const candidates = await listThumbnails(fixturePath("jpeg-flower"));
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].width, 160);
  assert.equal(candidates[0].height, 120);
});
