/**
 * Shared test helpers.
 *
 * Expected values come from the fixture manifest (`scripts/fixtures.ts`), which
 * is the single source of truth for what each sample contains (SPEC §8.3).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { FIXTURES } from "../scripts/fixtures.ts";

export { FIXTURES };

export const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/", import.meta.url));

export function fixture(id) {
  const found = FIXTURES.find((entry) => entry.id === id);
  assert.ok(found, `no fixture with id "${id}"`);
  return found;
}

export function fixturePath(id) {
  return FIXTURE_DIR + fixture(id).filename;
}

export function readFixture(id) {
  return readFile(fixturePath(id));
}

export function filesForFormat(format) {
  return FIXTURES.filter((entry) => entry.format === format);
}

/** Manifest previews in the order `listThumbnails` returns them. */
export function expectedCandidates(entry) {
  return [...entry.previews].sort(
    (a, b) => b.width * b.height - a.width * a.height || b.bytes - a.bytes,
  );
}

/** Asserts actual candidates match the manifest exactly, in order. */
export function assertCandidatesMatch(actual, entry) {
  const expected = expectedCandidates(entry);
  assert.equal(actual.length, expected.length, `${entry.id}: candidate count`);
  for (let i = 0; i < expected.length; i++) {
    const want = expected[i];
    const got = actual[i];
    const label = `${entry.id} candidate #${i}`;
    assert.equal(got.width, want.width, `${label} width`);
    assert.equal(got.height, want.height, `${label} height`);
    assert.equal(got.byteLength, want.bytes, `${label} byteLength`);
    assert.equal(got.decodable, want.decodable, `${label} decodable`);
    assert.equal(got.mimeType, "image/jpeg", `${label} mimeType`);
    assert.equal(got.origin, "embedded-jpeg", `${label} origin`);
    assert.equal(got.byteLength, got.data.byteLength, `${label} byteLength === data.byteLength`);
  }
}

/** A structurally valid TIFF with an empty IFD0 and therefore no previews. */
export function minimalTiffWithoutPreviews() {
  return Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II*\0, IFD0 at offset 8
    0x00, 0x00, // 0 entries
    0x00, 0x00, 0x00, 0x00, // next IFD offset = 0
  ]);
}
