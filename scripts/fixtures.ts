#!/usr/bin/env node
/**
 * Fixture downloader for thumbnail-extractor.
 *
 * Downloads genuine sample images (RAW / DNG / TIFF) from public sources into
 * `test/fixtures/`, which is gitignored. Every file is pinned by byte size and
 * SHA-256 so a download either matches exactly or fails loudly.
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
import { mkdir, readFile, stat, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "test", "fixtures");

/** Formats the extractor claims to support. Each must have a working fixture. */
export const SUPPORTED_FORMATS = ["tiff", "dng", "cr2"] as const;

export type FormatId = (typeof SUPPORTED_FORMATS)[number];

/** How an embedded preview is encoded. `lossless` previews are not viewable. */
type JpegKind = "baseline" | "progressive" | "lossless";

export interface PreviewExpectation {
  width: number;
  height: number;
  bytes: number;
  /** Where the bytes live inside the container. */
  kind: "strips" | "jpeg-interchange-format";
  jpeg: JpegKind;
  /** True when a normal JPEG decoder can open these bytes. */
  decodable: boolean;
}

export interface Fixture {
  id: string;
  format: FormatId;
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

/**
 * The manifest. URLs are hardcoded on purpose: fixtures must never silently
 * change under us, so every entry carries an exact size and SHA-256.
 */
export const FIXTURES: Fixture[] = [
  // ---------------------------------------------------------------- TIFF --
  {
    id: "tiff-child-ifd",
    format: "tiff",
    filename: "tiff-child-ifd.tiff",
    url: "https://raw.githubusercontent.com/python-pillow/Pillow/3078cab2618bf70537e5a1e646e156583af93ea3/Tests/images/child_ifd.tiff",
    bytes: 2971,
    sha256: "3ee712e0f777574336da10be36a2d09059fc45b4a0d08bd728174d7a4cada76e",
    license: "HPND (Pillow test images)",
    source: "python-pillow/Pillow",
    note: "Tiny TIFF with three JPEG-compressed images: 32x32 in IFD0, then 16x16 and 8x8 as SubIFDs.",
    previews: [
      { width: 32, height: 32, bytes: 647, kind: "strips", jpeg: "baseline", decodable: true },
      { width: 16, height: 16, bytes: 635, kind: "strips", jpeg: "baseline", decodable: true },
      { width: 8, height: 8, bytes: 635, kind: "strips", jpeg: "baseline", decodable: true },
    ],
  },
  {
    id: "tiff-old-style-jpeg",
    format: "tiff",
    filename: "tiff-old-style-jpeg.tif",
    url: "https://raw.githubusercontent.com/python-pillow/Pillow/3078cab2618bf70537e5a1e646e156583af93ea3/Tests/images/old-style-jpeg-compression.tif",
    bytes: 213760,
    sha256: "058d757030255eb21d4c42bf3ee7b79cb5527f25307cd6c140c0d799c65a817b",
    license: "HPND (Pillow test images)",
    source: "python-pillow/Pillow",
    note: "Large (4160x870) baseline JPEG stored in TIFF strips.",
    previews: [
      { width: 4160, height: 870, bytes: 212992, kind: "strips", jpeg: "baseline", decodable: true },
    ],
  },
  {
    id: "tiff-kodak-dcs520c",
    format: "tiff",
    filename: "tiff-kodak-dcs520c.tif",
    url: "https://raw.pixls.us/data/Kodak/DCS520C/23HK3627.TIF",
    bytes: 1970973,
    sha256: "d95e983bea9cf13f356e49b0f59629306bc7a51882ff20766c74ccff5f007d69",
    license: "CC0 1.0 (Public Domain)",
    source: "raw.pixls.us — Kodak DCS520C",
    note:
      "Real camera TIFF. Its preview is lossless JPEG (SOF3), which standalone " +
      "JPEG decoders reject — kept as an edge case, not counted as a working preview.",
    previews: [
      { width: 1736, height: 1160, bytes: 1697917, kind: "strips", jpeg: "lossless", decodable: false },
    ],
  },

  // ----------------------------------------------------------------- DNG --
  {
    id: "dng-canon-5d3-lossy",
    format: "dng",
    filename: "dng-canon-5d3-lossy.dng",
    url: "https://raw.pixls.us/data/Adobe%20DNG%20Converter/Canon%20EOS%205D%20Mark%20III/5G4A9394-compressed-lossy.DNG",
    bytes: 6193902,
    sha256: "159326856c29073e845c3c5a9ecf98c6474f43ca15798a88ad5e2baecd0664b7",
    license: "CC0 1.0 (Public Domain)",
    source: "raw.pixls.us — Adobe DNG Converter, Canon EOS 5D Mark III",
    note: "Contains three baseline-JPEG previews in nested SubIFDs (256x171, 1024x683, 5760x3840).",
    previews: [
      { width: 256, height: 171, bytes: 11034, kind: "strips", jpeg: "baseline", decodable: true },
      { width: 1024, height: 683, bytes: 49574, kind: "strips", jpeg: "baseline", decodable: true },
      { width: 5760, height: 3840, bytes: 1235564, kind: "strips", jpeg: "baseline", decodable: true },
    ],
  },

  // ----------------------------------------------------------------- CR2 --
  {
    id: "cr2-canon-40d",
    format: "cr2",
    filename: "cr2-canon-40d.cr2",
    url: "https://raw.pixls.us/data/Canon/EOS%2040D/_MG_0153.CR2",
    bytes: 10931826,
    sha256: "775c806358fedddec7622113a5e399a3330bd5a65e35e37ae1108d8bf58067be",
    license: "CC0 1.0 (Public Domain)",
    source: "raw.pixls.us — Canon EOS 40D",
    note:
      "CR2 header (IFD0 -> IFD3) plus a JPEGInterchangeFormat thumbnail. " +
      "The full-size IFD4 preview is lossless JPEG (SOF3).",
    previews: [
      { width: 1936, height: 1288, bytes: 365662, kind: "strips", jpeg: "baseline", decodable: true },
      { width: 160, height: 120, bytes: 8071, kind: "jpeg-interchange-format", jpeg: "baseline", decodable: true },
      { width: 3888, height: 2592, bytes: 9578955, kind: "strips", jpeg: "lossless", decodable: false },
    ],
  },
];

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
  const { rename } = await import("node:fs/promises");
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
  let downloaded = 0;
  for (const f of pending) {
    await fetchWithRetry(f);
    downloaded++;
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
