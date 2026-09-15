#!/usr/bin/env node
/**
 * Fixture downloader for thumbnail-extractor.
 *
 * Downloads genuine sample images (RAW / DNG / TIFF) from public sources into
 * `test/fixtures/`, which is gitignored. The catalog lives in `fixtures.yaml`
 * next to this script; every file is pinned by byte size and SHA-256 so a
 * download either matches exactly or fails loudly.
 *
 * Run directly with Node (no build step):
 *
 *   node scripts/fixtures.ts            # download missing fixtures
 *   node scripts/fixtures.ts --force    # re-download everything
 *   node scripts/fixtures.ts --check    # verify on-disk fixtures + acceptance criteria
 *   node scripts/fixtures.ts --list     # print the manifest, download nothing
 *
 * Acceptance criteria (enforced by --check):
 *   every supported format must have at least one *working* fixture, i.e. a
 *   sample that really contains a decodable embedded JPEG preview.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile, unlink, rename } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";
import { parse as parseYaml } from "yaml";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "test", "fixtures");
const MANIFEST_PATH = join(HERE, "fixtures.yaml");

/** How an embedded preview is encoded. `lossless` previews are not viewable. */
type JpegKind = "baseline" | "progressive" | "lossless";

type PreviewKind = "strips" | "jpeg-interchange-format";

export interface PreviewExpectation {
  width: number;
  height: number;
  bytes: number;
  /** Where the bytes live inside the container. */
  kind: PreviewKind;
  jpeg: JpegKind;
  /** True when a normal JPEG decoder can open these bytes. */
  decodable: boolean;
}

export interface Fixture {
  id: string;
  format: string;
  filename: string;
  url: string;
  bytes: number;
  sha256: string;
  /** Upstream license of the sample, as published by the source. */
  license: string;
  source: string;
  note?: string;
  previews: PreviewExpectation[];
}

const JPEG_KINDS = new Set<JpegKind>(["baseline", "progressive", "lossless"]);
const PREVIEW_KINDS = new Set<PreviewKind>(["strips", "jpeg-interchange-format"]);
const SHA256_RE = /^[0-9a-f]{64}$/;

function fail(path: string, message: string): never {
  throw new Error(`${basename(MANIFEST_PATH)}: ${path}: ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(path, "must be a non-empty string");
  }
  return value.trim();
}

function asInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(path, "must be a non-negative integer");
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be true or false");
  return value;
}

function parsePreview(value: unknown, path: string): PreviewExpectation {
  if (!isPlainObject(value)) fail(path, "must be a mapping");
  const kind = asString(value.kind, `${path}.kind`);
  if (!PREVIEW_KINDS.has(kind as PreviewKind)) {
    fail(path, `kind must be one of ${[...PREVIEW_KINDS].join(", ")}`);
  }
  const jpeg = asString(value.jpeg, `${path}.jpeg`);
  if (!JPEG_KINDS.has(jpeg as JpegKind)) {
    fail(path, `jpeg must be one of ${[...JPEG_KINDS].join(", ")}`);
  }
  return {
    width: asInteger(value.width, `${path}.width`),
    height: asInteger(value.height, `${path}.height`),
    bytes: asInteger(value.bytes, `${path}.bytes`),
    kind: kind as PreviewKind,
    jpeg: jpeg as JpegKind,
    decodable: asBoolean(value.decodable, `${path}.decodable`),
  };
}

function parseFixture(value: unknown, format: string, path: string): Fixture {
  if (!isPlainObject(value)) fail(path, "must be a mapping");
  const filename = asString(value.filename, `${path}.filename`);
  if (filename !== basename(filename) || filename === "." || filename === "..") {
    fail(path, "filename must be a bare file name, not a path");
  }
  const sha256 = asString(value.sha256, `${path}.sha256`).toLowerCase();
  if (!SHA256_RE.test(sha256)) fail(path, "sha256 must be 64 lowercase hex characters");
  const url = asString(value.url, `${path}.url`);
  if (!/^https:\/\//.test(url)) fail(path, "url must be an https URL");
  if (!Array.isArray(value.previews) || value.previews.length === 0) {
    fail(path, "previews must be a non-empty list");
  }
  const note = value.note === undefined ? undefined : asString(value.note, `${path}.note`);
  return {
    id: asString(value.id, `${path}.id`),
    format,
    filename,
    url,
    bytes: asInteger(value.bytes, `${path}.bytes`),
    sha256,
    license: asString(value.license, `${path}.license`),
    source: asString(value.source, `${path}.source`),
    ...(note ? { note } : {}),
    previews: value.previews.map((preview, i) => parsePreview(preview, `${path}.previews[${i}]`)),
  };
}

function loadManifest(): { formats: string[]; fixtures: Fixture[] } {
  let raw: string;
  try {
    raw = readFileSync(MANIFEST_PATH, "utf8");
  } catch (err) {
    throw new Error(`could not read ${MANIFEST_PATH}: ${(err as Error).message}`);
  }

  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    throw new Error(`${basename(MANIFEST_PATH)}: ${(err as Error).message}`);
  }

  if (!isPlainObject(doc) || !isPlainObject(doc.formats)) {
    fail("formats", "must be a mapping of format id → list of fixtures");
  }

  const formats = Object.keys(doc.formats);
  if (formats.length === 0) fail("formats", "must list at least one format");

  const fixtures: Fixture[] = [];
  const seenIds = new Set<string>();
  for (const format of formats) {
    if (!/^[a-z][a-z0-9-]*$/.test(format)) {
      fail(`formats.${format}`, "format id must be lowercase alphanumeric (hyphens allowed)");
    }
    const entries = doc.formats[format];
    if (!Array.isArray(entries)) fail(`formats.${format}`, "must be a list");
    for (let i = 0; i < entries.length; i++) {
      const fixture = parseFixture(entries[i], format, `formats.${format}[${i}]`);
      if (seenIds.has(fixture.id)) fail(`formats.${format}[${i}].id`, `duplicate id "${fixture.id}"`);
      seenIds.add(fixture.id);
      fixtures.push(fixture);
    }
  }

  return { formats, fixtures };
}

const manifest = loadManifest();

/** Formats the extractor claims to support. Each must have a working fixture. */
export const SUPPORTED_FORMATS: readonly string[] = Object.freeze(manifest.formats);

export type FormatId = (typeof SUPPORTED_FORMATS)[number];

/**
 * The catalog from `fixtures.yaml`. URLs are hardcoded on purpose: fixtures
 * must never silently change under us, so every entry carries an exact size
 * and SHA-256.
 */
export const FIXTURES: Fixture[] = manifest.fixtures;

// --------------------------------------------------------------- helpers --

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

function hasWorkingPreview(f: Fixture): boolean {
  return f.previews.some((p) => p.decodable);
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

/** Returns the file size, or undefined when the file is absent. */
async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

/** Verifies an on-disk file against a manifest entry. */
async function verify(
  f: Fixture,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const path = join(FIXTURE_DIR, f.filename);
  const size = await sizeOf(path);
  if (size === undefined) return { ok: false, reason: "missing" };
  if (size !== f.bytes) {
    return { ok: false, reason: `size mismatch (expected ${f.bytes}, found ${size})` };
  }
  const actual = await sha256File(path);
  if (actual !== f.sha256) {
    return { ok: false, reason: `sha256 mismatch (expected ${f.sha256.slice(0, 12)}…, found ${actual.slice(0, 12)}…)` };
  }
  return { ok: true };
}

const USER_AGENT = "thumbnail-extractor-fixtures/1.0 (+https://github.com/)";

/** Streams a URL to disk, hashing as it goes so nothing is buffered in memory. */
async function download(url: string, dest: string): Promise<{ bytes: number; sha256: string }> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("response had no body");

  const hash = createHash("sha256");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    const buf = Buffer.from(chunk);
    hash.update(buf);
    chunks.push(buf);
    total += buf.length;
  }
  const body = Buffer.concat(chunks);
  // Write via a temp file so a failed download never leaves a partial fixture.
  const tmp = `${dest}.part`;
  await writeFile(tmp, body);
  await rename(tmp, dest);
  return { bytes: total, sha256: hash.digest("hex") };
}

async function fetchWithRetry(f: Fixture, attempts = 3): Promise<void> {
  const dest = join(FIXTURE_DIR, f.filename);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const label = attempt > 1 ? ` (attempt ${attempt}/${attempts})` : "";
      process.stdout.write(`  ↓ ${f.filename} ${formatBytes(f.bytes)}${label}\n`);
      const { bytes, sha256 } = await download(f.url, dest);
      if (bytes !== f.bytes) {
        throw new Error(`size mismatch: expected ${f.bytes}, got ${bytes}`);
      }
      if (sha256 !== f.sha256) {
        throw new Error(`sha256 mismatch: expected ${f.sha256}, got ${sha256}`);
      }
      process.stdout.write(`  ✓ ${f.filename} verified\n`);
      return;
    } catch (err) {
      lastError = err;
      await unlink(join(FIXTURE_DIR, `${f.filename}.part`)).catch(() => {});
      if (attempt < attempts) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  throw new Error(`failed to download ${f.id}: ${(lastError as Error)?.message ?? lastError}`);
}

// ----------------------------------------------------------------- modes --

function printManifest(): void {
  console.log(`\n${FIXTURES.length} fixtures across ${SUPPORTED_FORMATS.length} formats\n`);
  for (const format of SUPPORTED_FORMATS) {
    const entries = FIXTURES.filter((f) => f.format === format);
    const working = entries.filter(hasWorkingPreview).length;
    console.log(`${format.toUpperCase()}  (${working}/${entries.length} with a working preview)`);
    for (const f of entries) {
      const flag = hasWorkingPreview(f) ? "✓" : "•";
      console.log(`  ${flag} ${f.id}`);
      console.log(`      ${f.filename}  ${formatBytes(f.bytes)}`);
      console.log(`      ${f.url}`);
      console.log(`      license: ${f.license}`);
      if (f.note) console.log(`      note: ${f.note}`);
    }
    console.log();
  }
}

async function runCheck(): Promise<number> {
  let failures = 0;

  console.log(`\nVerifying fixtures in ${FIXTURE_DIR}\n`);
  for (const f of FIXTURES) {
    const result = await verify(f);
    if (result.ok) {
      console.log(`  ✓ ${f.filename}`);
    } else {
      console.log(`  ✗ ${f.filename}: ${result.reason}`);
      failures++;
    }
  }

  console.log("\nAcceptance criteria: at least one working fixture per format\n");
  for (const format of SUPPORTED_FORMATS) {
    const entries = FIXTURES.filter((f) => f.format === format);
    const ready: Fixture[] = [];
    for (const f of entries) {
      if (hasWorkingPreview(f) && (await verify(f)).ok) ready.push(f);
    }
    if (ready.length > 0) {
      console.log(`  ✓ ${format}: ${ready.map((f) => f.filename).join(", ")}`);
    } else {
      console.log(`  ✗ ${format}: no verified fixture with a working preview`);
      failures++;
    }
  }

  console.log();
  if (failures > 0) {
    console.log(`${failures} problem(s). Run \`npm run fixtures\` to download.\n`);
    return 1;
  }
  console.log("All fixtures present and verified.\n");
  return 0;
}

async function runDownload(force: boolean): Promise<number> {
  await mkdir(FIXTURE_DIR, { recursive: true });

  const pending: Fixture[] = [];
  for (const f of FIXTURES) {
    if (!force) {
      const result = await verify(f);
      if (result.ok) {
        console.log(`  = ${f.filename} already present`);
        continue;
      }
    }
    pending.push(f);
  }

  if (pending.length === 0) {
    console.log("\nNothing to do — all fixtures verified.\n");
    return 0;
  }

  console.log(`\nDownloading ${pending.length} fixture(s) into ${FIXTURE_DIR}\n`);
  for (const f of pending) {
    await fetchWithRetry(f);
  }

  console.log("\nRunning acceptance check…");
  return runCheck();
}

// ------------------------------------------------------------------ main --

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const known = ["--force", "--check", "--list", "--help", "-h"];
  for (const a of args) {
    if (!known.includes(a)) {
      console.error(`Unknown flag: ${a}\n`);
      process.exit(2);
    }
  }

  if (args.has("--help") || args.has("-h")) {
    console.log(
      [
        "Usage: node scripts/fixtures.ts [options]",
        "",
        "  Catalog: scripts/fixtures.yaml",
        "",
        "  (no options)  download any missing fixtures, then verify",
        "  --force       re-download every fixture",
        "  --check       verify on-disk fixtures and the per-format acceptance criteria",
        "  --list        print the fixture manifest without downloading",
      ].join("\n"),
    );
    return;
  }

  if (args.has("--list")) {
    printManifest();
    return;
  }

  if (args.has("--check")) {
    process.exit(await runCheck());
  }

  process.exit(await runDownload(args.has("--force")));
}

// Importing this module must stay side-effect free so tests can read the
// manifest; only execute when run directly.
if (import.meta.main) {
  main().catch((err) => {
    console.error(`\nFatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
