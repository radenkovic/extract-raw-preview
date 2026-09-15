#!/usr/bin/env node
/**
 * Writes the best embedded preview from each on-disk fixture into
 * `test/fixtures/thumbs/` so the extracted JPEGs can be inspected by eye.
 *
 * Requires a prior `npm run build` (the npm script does this) and downloaded
 * fixtures (`npm run fixtures`).
 *
 *   node scripts/fixtures-thumbs.ts
 *   node scripts/fixtures-thumbs.ts --help
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractThumbnail } from "../dist/index.js";
import { FIXTURES } from "./fixtures.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "..", "test", "fixtures");
const THUMB_DIR = join(FIXTURE_DIR, "thumbs");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

function thumbFilename(sourceName: string, mimeType: string): string {
  const stem = basename(sourceName, extname(sourceName));
  const ext = mimeType === "image/png" ? "png" : "jpg";
  return `${stem}.${ext}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function run(): Promise<number> {
  if (!(await exists(join(HERE, "..", "dist", "index.js")))) {
    console.error(
      "dist/ is missing. Run `npm run build` first (or use `npm run fixtures:thumbs`).\n",
    );
    return 1;
  }

  await rm(THUMB_DIR, { recursive: true, force: true });
  await mkdir(THUMB_DIR, { recursive: true });

  let extracted = 0;
  let skipped = 0;
  let failures = 0;

  console.log(`\nExtracting thumbnails into ${THUMB_DIR}\n`);

  for (const fixture of FIXTURES) {
    const source = join(FIXTURE_DIR, fixture.filename);
    if (!(await exists(source))) {
      console.log(`  ✗ ${fixture.filename}: missing (run \`npm run fixtures\`)`);
      failures++;
      continue;
    }

    const wantsPreview = fixture.previews.some((preview) => preview.decodable);
    try {
      const result = await extractThumbnail(source, { maxBytes: Number.MAX_SAFE_INTEGER });
      if (!result.found) {
        if (wantsPreview) {
          console.log(`  ✗ ${fixture.filename}: ${result.reason}`);
          failures++;
        } else {
          console.log(`  • ${fixture.filename}: ${result.reason}`);
          skipped++;
        }
        continue;
      }

      const destName = thumbFilename(fixture.filename, result.mimeType);
      await writeFile(join(THUMB_DIR, destName), result.data);
      console.log(
        `  ✓ ${fixture.filename} → ${destName}  ${result.width}×${result.height}  ${formatBytes(result.byteLength)}`,
      );
      extracted++;
    } catch (err) {
      console.log(`  ✗ ${fixture.filename}: ${(err as Error).message}`);
      failures++;
    }
  }

  console.log();
  console.log(`${extracted} thumbnail(s) written`);
  if (skipped > 0) console.log(`${skipped} fixture(s) have no extractable preview`);
  if (failures > 0) {
    console.log(`${failures} problem(s).\n`);
    return 1;
  }
  console.log();
  return 0;
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const known = ["--help", "-h"];
  for (const a of args) {
    if (!known.includes(a)) {
      console.error(`Unknown flag: ${a}\n`);
      process.exit(2);
    }
  }

  if (args.has("--help") || args.has("-h")) {
    console.log(
      [
        "Usage: node scripts/fixtures-thumbs.ts",
        "",
        "  Extract the best embedded preview from every on-disk fixture",
        "  into test/fixtures/thumbs/ (gitignored, rebuilt each run).",
        "",
        "  Requires: npm run build && npm run fixtures",
      ].join("\n"),
    );
    return;
  }

  process.exit(await run());
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`\nFatal: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
