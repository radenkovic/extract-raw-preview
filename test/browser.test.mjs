/**
 * Browser entry: bytes-only API, no Node built-ins in the import graph.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { detectFormat, extractThumbnail, listThumbnails } from "../dist/browser.js";
import { fixturePath, readFixture } from "./helpers.mjs";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

async function collectModuleGraph(entry) {
  const seen = new Set();
  const nodeImports = [];
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const spec = match[1];
      if (spec.startsWith("node:")) {
        nodeImports.push({ file, spec });
        continue;
      }
      if (spec.startsWith(".")) {
        queue.push(join(dirname(file), spec));
      }
    }
  }

  return { files: seen, nodeImports };
}

test("browser entry import graph has no node: built-ins", async () => {
  const { files, nodeImports } = await collectModuleGraph(join(DIST, "browser.js"));
  assert.equal(nodeImports.length, 0, JSON.stringify(nodeImports, null, 2));
  assert.equal(files.has(join(DIST, "index.js")), false);
  assert.equal(files.has(join(DIST, "cli.js")), false);
});

test("Node entry still uses node:fs for path input", async () => {
  const { nodeImports } = await collectModuleGraph(join(DIST, "index.js"));
  assert.ok(
    nodeImports.some((entry) => entry.spec === "node:fs/promises"),
    "expected the Node entry to import node:fs/promises",
  );
});

test("browser entry extracts a TIFF preview from bytes", async () => {
  const bytes = await readFixture("tiff-child-ifd");
  const result = await extractThumbnail(bytes);
  assert.equal(result.found, true);
  assert.equal(result.format, "tiff");
  assert.equal(result.width, 32);
  assert.equal(result.height, 32);
  assert.equal(result.origin, "embedded-jpeg");
  assert.equal(result.mimeType, "image/jpeg");
});

test("browser entry lists and sniffs the same TIFF bytes", async () => {
  const bytes = await readFixture("tiff-child-ifd");
  assert.equal(await detectFormat(bytes), "tiff");
  const candidates = await listThumbnails(bytes);
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].width, 32);
});

test("browser entry rejects a path string", async () => {
  await assert.rejects(
    () => extractThumbnail(fixturePath("tiff-child-ifd")),
    (error) => error.code === "ERR_IO",
  );
});

test("browser entry is importable via the package browser export", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.browser, "./dist/browser.js");
  assert.equal(pkg.exports["."].browser.default, "./dist/browser.js");
  assert.equal(pkg.exports["."].browser.types, "./dist/browser.d.ts");
  const resolved = await import(pathToFileURL(join(DIST, "browser.js")).href);
  assert.equal(typeof resolved.extractThumbnail, "function");
});
