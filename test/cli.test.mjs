/** CLI contract: output shape and exit codes (SPEC §7). */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { extractThumbnail } from "../dist/index.js";
import { fixturePath, minimalTiffWithoutPreviews } from "./helpers.mjs";

const execFileAsync = promisify(execFile);
const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

let workDir;
let emptyTiffPath;

before(async () => {
  workDir = await mkdtemp(join(tmpdir(), "thumbnail-extractor-cli-"));
  emptyTiffPath = join(workDir, "empty.tif");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(emptyTiffPath, minimalTiffWithoutPreviews());
});

after(async () => {
  await rm(workDir, { recursive: true, force: true });
});

/** Runs the CLI, capturing the exit code instead of throwing. */
async function cli(args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

test("--help exits 0 with usage on stdout", async () => {
  const { code, stdout, stderr } = await cli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /^Usage: thumbnail-extractor/);
  assert.equal(stderr, "");
});

test("an unknown flag is a usage error (exit 2)", async () => {
  const { code, stderr } = await cli([fixturePath("tiff-child-ifd"), "--nope"]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown flag/);
});

test("a missing input file argument is a usage error (exit 2)", async () => {
  const { code, stderr } = await cli([]);
  assert.equal(code, 2);
  assert.match(stderr, /missing input file/);
});

test("an invalid --format is a usage error (exit 2)", async () => {
  const { code, stderr } = await cli([fixturePath("tiff-child-ifd"), "--format", "nope"]);
  assert.equal(code, 2);
  assert.match(stderr, /unknown format/);
});

test("an invalid --prefer is a usage error (exit 2)", async () => {
  const { code } = await cli([fixturePath("tiff-child-ifd"), "--prefer", "sideways"]);
  assert.equal(code, 2);
});

test("--format without a value is a usage error (exit 2)", async () => {
  const { code } = await cli([fixturePath("tiff-child-ifd"), "--format"]);
  assert.equal(code, 2);
});

test("an unreadable path is an operational error (exit 1)", async () => {
  const { code, stderr } = await cli([join(workDir, "nope.tif")]);
  assert.equal(code, 1);
  assert.match(stderr, /^error: /);
});

test("unrecognized content is an operational error (exit 1)", async () => {
  const junk = join(workDir, "junk.bin");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(junk, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));

  const { code, stderr } = await cli([junk]);
  assert.equal(code, 1);
  assert.match(stderr, /no known image signature/);
});

test("--format skips sniffing even when the container is a different flavour", async () => {
  // Forcing cr2 on a TIFF still parses: the containers are both TIFF, and the
  // flag means "do not sniff", not "reject mismatches".
  const { code, stdout } = await cli([
    fixturePath("tiff-child-ifd"),
    "--format",
    "cr2",
    "--json",
    "-o",
    join(workDir, "forced-cr2.jpg"),
  ]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).format, "cr2");
});

test("extracts to an explicit output path and prints one summary line", async () => {
  const output = join(workDir, "explicit.jpg");
  const source = fixturePath("tiff-old-style-jpeg");
  const { code, stdout, stderr } = await cli([source, "-o", output]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout.trim(), `${output}  4160x870  image/jpeg  212992`);

  const written = await readFile(output);
  const expected = await extractThumbnail(source);
  assert.equal(expected.found, true);
  assert.deepEqual(written, Buffer.from(expected.data));
});

test("defaults the output path to <basename>.thumb.<ext> next to the source", async () => {
  const local = join(workDir, "tiff-child-ifd.tiff");
  await copyFile(fixturePath("tiff-child-ifd"), local);

  const { code, stdout } = await cli([local]);
  assert.equal(code, 0);

  const expectedPath = join(workDir, "tiff-child-ifd.thumb.jpg");
  assert.equal(stdout.trim().split("  ")[0], expectedPath);
  assert.ok(await exists(expectedPath), "default output file must be written");
});

test("--json emits a single parseable value with outputPath and no data", async () => {
  const output = join(workDir, "json.jpg");
  const { code, stdout, stderr } = await cli([
    fixturePath("dng-canon-5d3-lossy"),
    "-o",
    output,
    "--json",
  ]);

  assert.equal(code, 0);
  assert.equal(stderr, "");

  const payload = JSON.parse(stdout);
  assert.equal(payload.found, true);
  assert.equal(payload.format, "dng");
  assert.equal(payload.width, 5760);
  assert.equal(payload.height, 3840);
  assert.equal(payload.byteLength, 1235564);
  assert.equal(payload.mimeType, "image/jpeg");
  assert.equal(payload.origin, "embedded-jpeg");
  assert.equal(payload.decodable, true);
  assert.equal(payload.outputPath, output);
  assert.equal("data" in payload, false);
});

test("a found:false result is still valid JSON on stdout and exits 0", async () => {
  const { code, stdout, stderr } = await cli([fixturePath("tiff-kodak-dcs520c"), "--json"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");

  const payload = JSON.parse(stdout);
  assert.equal(payload.found, false);
  assert.equal(payload.format, "tiff");
  assert.equal(payload.reason, "only lossless-jpeg preview present");
});

test("human mode on a found:false result writes the reason to stderr and exits 0", async () => {
  const { code, stdout, stderr } = await cli([fixturePath("tiff-kodak-dcs520c")]);
  assert.equal(code, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /no preview extracted: only lossless-jpeg preview present/);
});

test("--list prints every candidate and writes nothing", async () => {
  // A dedicated directory so a file left behind by another test cannot hide a
  // regression here.
  const dir = join(workDir, "list-case");
  await mkdir(dir, { recursive: true });
  const local = join(dir, "tiff-child-ifd.tiff");
  await copyFile(fixturePath("tiff-child-ifd"), local);

  const { code, stdout, stderr } = await cli([local, "--list"]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^.*32x32 {2}image\/jpeg {2}647$/);
  assert.deepEqual(await readdir(dir), ["tiff-child-ifd.tiff"]);
});

test("--list --json emits an array of candidates without data", async () => {
  const { code, stdout } = await cli([fixturePath("cr2-canon-40d"), "--list", "--json"]);
  assert.equal(code, 0);

  const payload = JSON.parse(stdout);
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 3);
  assert.deepEqual(
    payload.map((candidate) => `${candidate.width}x${candidate.height}`),
    ["3888x2592", "1936x1288", "160x120"],
  );
  assert.equal(
    payload.every((candidate) => !("data" in candidate)),
    true,
  );
});

test("--list on a container with no previews prints [] and exits 0", async () => {
  const { code, stdout } = await cli([emptyTiffPath, "--list", "--json"]);
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), []);
});

test("--prefer smallest selects the smallest candidate", async () => {
  const { code, stdout } = await cli([
    fixturePath("tiff-child-ifd"),
    "--prefer",
    "smallest",
    "--json",
    "-o",
    join(workDir, "small.jpg"),
  ]);
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.width, 8);
  assert.equal(payload.height, 8);
});

test("--max-bytes that excludes everything reports all candidates exceed maxBytes", async () => {
  const { code, stdout } = await cli([fixturePath("tiff-child-ifd"), "--max-bytes", "0", "--json"]);
  assert.equal(code, 0);
  const payload = JSON.parse(stdout);
  assert.equal(payload.found, false);
  assert.equal(payload.reason, "all candidates exceed maxBytes");
});

test("--format forces an extractor and skips sniffing", async () => {
  const { code, stdout } = await cli([
    fixturePath("tiff-child-ifd"),
    "--format",
    "tiff",
    "--json",
    "-o",
    join(workDir, "forced.jpg"),
  ]);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).format, "tiff");
});

test("operational errors under --json still produce parseable stdout", async () => {
  const { code, stdout } = await cli([join(workDir, "missing.tif"), "--json"]);
  assert.equal(code, 1);
  const payload = JSON.parse(stdout);
  assert.equal(payload.error.code, "ERR_IO");
});

test("the binary is declared in package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.bin["thumbnail-extractor"], "./dist/cli.js");
  assert.equal(basename(CLI), "cli.js");
});
