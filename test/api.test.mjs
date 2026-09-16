/** Public API behaviour: input resolution, errors, invariants (SPEC §4). */

import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { detectFormat, extractThumbnail, listThumbnails } from "../dist/index.js";
import {
  FIXTURE_DIR,
  FIXTURES,
  fixturePath,
  minimalTiffWithoutPreviews,
  readFixture,
} from "./helpers.mjs";

const hasCode = (code) => (error) => error.code === code;

test("accepts a path, a file: URL and raw bytes", async () => {
  const path = fixturePath("tiff-child-ifd");
  const fromPath = await extractThumbnail(path);
  const fromUrl = await extractThumbnail(pathToFileURL(path));
  const fromBytes = await extractThumbnail(await readFixture("tiff-child-ifd"));

  assert.equal(fromPath.found, true);
  assert.equal(fromUrl.found, true);
  assert.equal(fromBytes.found, true);
  assert.equal(fromUrl.width, fromPath.width);
  assert.equal(fromBytes.byteLength, fromPath.byteLength);
});

test("detectFormat returns undefined for unrecognized bytes", async () => {
  assert.equal(await detectFormat(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])), undefined);
});

test("rejects a non-file: URL with ERR_IO", async () => {
  await assert.rejects(
    () => extractThumbnail(new URL("https://example.com/photo.tif")),
    hasCode("ERR_IO"),
  );
});

test("rejects a missing path with ERR_IO", async () => {
  await assert.rejects(
    () => extractThumbnail(join(FIXTURE_DIR, "does-not-exist.tif")),
    hasCode("ERR_IO"),
  );
});

test("rejects unrecognized input with ERR_UNRECOGNIZED_FORMAT", async () => {
  await assert.rejects(
    () => extractThumbnail(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    hasCode("ERR_UNRECOGNIZED_FORMAT"),
  );
});

test("rejects an unregistered forced format with ERR_UNSUPPORTED_FORMAT", async () => {
  await assert.rejects(
    () => extractThumbnail(fixturePath("tiff-child-ifd"), { format: "nope" }),
    hasCode("ERR_UNSUPPORTED_FORMAT"),
  );
});

test("forcing the right format skips sniffing and still works", async () => {
  const result = await extractThumbnail(fixturePath("tiff-child-ifd"), { format: "tiff" });
  assert.equal(result.found, true);
  assert.equal(result.format, "tiff");
  assert.equal(result.width, 32);
});

test("rejects a truncated container with ERR_TRUNCATED", async () => {
  const bytes = (await readFixture("tiff-child-ifd")).subarray(0, 12);
  await assert.rejects(() => extractThumbnail(bytes), hasCode("ERR_TRUNCATED"));
});

test("preview data past the end of a truncated file is treated as absent", async () => {
  // The IFD itself is intact but every strip now lies beyond the buffer, so the
  // optional structure is dropped rather than throwing (SPEC §5.2).
  const bytes = (await readFixture("tiff-child-ifd")).subarray(0, 500);
  const result = await extractThumbnail(bytes);
  assert.equal(result.found, false);
  assert.equal(result.format, "tiff");
  assert.equal(result.reason, "no embedded preview");
});

test("a found result carries exactly the documented public fields", async () => {
  const result = await extractThumbnail(fixturePath("tiff-child-ifd"));
  assert.deepEqual(Object.keys(result).sort(), [
    "byteLength",
    "data",
    "decodable",
    "format",
    "found",
    "height",
    "mimeType",
    "origin",
    "width",
  ]);
});

test("a not-found result carries only found, format and reason", async () => {
  const result = await extractThumbnail(fixturePath("tiff-kodak-dcs520c"));
  assert.deepEqual(Object.keys(result).sort(), ["format", "found", "reason"]);
});

test("data is a fresh copy, not a view into the caller's buffer", async () => {
  const input = await readFixture("tiff-old-style-jpeg");
  const result = await extractThumbnail(input);
  assert.equal(result.found, true);

  const before = Uint8Array.from(result.data);
  input.fill(0xff);
  assert.deepEqual(Uint8Array.from(result.data), before);
  assert.equal(result.byteLength, result.data.byteLength);
});

test("returned bytes are byte-for-byte as stored in the container", async () => {
  for (const entry of FIXTURES) {
    const source = await readFixture(entry.id);
    for (const candidate of await listThumbnails(fixturePath(entry.id))) {
      if (candidate.origin === "reencoded") continue;
      assert.ok(
        source.includes(Buffer.from(candidate.data)),
        `${entry.id}: preview bytes must appear verbatim in the container`,
      );
    }
  }
});

test("maxBytes filters candidates instead of failing the call", async () => {
  const result = await extractThumbnail(fixturePath("dng-canon-5d3-lossy"), {
    maxBytes: 60_000,
  });
  assert.equal(result.found, true);
  assert.equal(result.width, 1024);
  assert.equal(result.height, 683);
  assert.equal(result.byteLength, 49574);
});

test("when every candidate exceeds the cap the result is a found:false outcome", async () => {
  const result = await extractThumbnail(fixturePath("dng-canon-5d3-lossy"), {
    maxBytes: 1_000,
  });
  assert.equal(result.found, false);
  assert.equal(result.format, "dng");
  assert.equal(result.reason, "all candidates exceed maxBytes");
});

test("listThumbnails ignores maxBytes entirely", async () => {
  const candidates = await listThumbnails(fixturePath("cr2-canon-40d"));
  assert.equal(candidates.length, 3);
  assert.ok(candidates[0].byteLength > 8 * 1024 * 1024);
});

test("listThumbnails sorts by pixel count descending and keeps non-decodable entries", async () => {
  const candidates = await listThumbnails(fixturePath("cr2-canon-40d"));
  const pixels = candidates.map((candidate) => candidate.width * candidate.height);
  assert.deepEqual(
    pixels,
    [...pixels].sort((a, b) => b - a),
  );
  assert.ok(candidates.some((candidate) => candidate.decodable === false));
});

test("listThumbnails returns an empty array for a container with no previews", async () => {
  assert.deepEqual(await listThumbnails(minimalTiffWithoutPreviews()), []);
});

test("a container with no previews reports no embedded preview", async () => {
  const result = await extractThumbnail(minimalTiffWithoutPreviews());
  assert.equal(result.found, false);
  assert.equal(result.format, "tiff");
  assert.equal(result.reason, "no embedded preview");
});

test("failure reasons are punctuation-free and match the documented strings", async () => {
  // SPEC §3.2 asks for lowercase, punctuation-free reasons, but its own example
  // for the cap case is `all candidates exceed maxBytes` — camelCase. The
  // concrete strings below are therefore what is enforced.
  const cases = [
    [
      await extractThumbnail(fixturePath("tiff-kodak-dcs520c")),
      "only lossless-jpeg preview present",
    ],
    [await extractThumbnail(minimalTiffWithoutPreviews()), "no embedded preview"],
    [
      await extractThumbnail(fixturePath("dng-canon-5d3-lossy"), { maxBytes: 1 }),
      "all candidates exceed maxBytes",
    ],
  ];

  for (const [result, expected] of cases) {
    assert.equal(result.found, false);
    assert.equal(result.reason, expected);
    assert.match(result.reason, /^[A-Za-z0-9 -]+$/, `reason "${result.reason}"`);
  }
});
