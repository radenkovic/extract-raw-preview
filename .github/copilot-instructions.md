# thumbnail-extractor

ESM-only TypeScript library. Node.js 20+. Package manager is **npm**. Runtime dependencies (including native addons and WASM) are allowed when they unlock a format or make a preview extractable.

## Commands

```bash
npm install
npm run fixtures       # download SHA-pinned samples into test/fixtures/ (gitignored)
npm run fixtures:thumbs  # extract previews into test/fixtures/thumbs/
npm run lint           # biome check
npm run typecheck
npm test               # fixtures:check + tsc + node --test test/
npm run check          # lint + typecheck + test
```

Run `npm run fixtures` before tests. `npm test` runs `fixtures:check` as `pretest` and fails if any supported format lacks a verified on-disk sample with a decodable preview. Never commit `test/fixtures/` or `dist/`.

Finish work with `npm run check` passing. Use Biome (`npm run lint:fix`) rather than Prettier/ESLint.

## Architecture

- `src/index.ts` — public API: `detectFormat`, `listThumbnails`, `extractThumbnail`
- `src/sniff.ts` — magic-byte detection (first 64 KiB). New signatures go here.
- `src/registry.ts` — `FormatId` → extractor. One import + one object key per format.
- `src/types.ts` — closed `FormatId` union; extend it when shipping a format
- `src/formats/<id>.ts` — extractor. `matches(bytes)` + `extract(reader)`
- `src/formats/shared.ts` — TIFF-family IFD walking. Prefer configuring this over copying it.
- `src/ifd.ts` / `src/bmff.ts` / `src/heif.ts` / `src/jpeg.ts` / `src/reader.ts` — container helpers
- `src/reencode.ts` — decode + JPEG encode when the container has no stored JPEG/PNG (`libheif-js`, `sharp`)
- `scripts/fixtures.yaml` — catalog of test samples, pinned by URL, byte size, and SHA-256

Imports use `.js` extensions (Node ESM + `tsc`).

## Invariants

- Copy stored JPEG/PNG preview bytes when they exist. Decode and JPEG-encode when that is what it takes to return a usable preview (HEVC/AV1 in HEIC/AVIF today). Never decode the full mosaiced RAW.
- Missing/unusable preview **resolves** `{ found: false, format, reason }`. Reasons are lowercase and punctuation-free (`no embedded preview`, `only lossless-jpeg preview present`, `no decodable preview present`, `all candidates exceed maxBytes`).
- Broken input **rejects** `ExtractError` with `ERR_UNRECOGNIZED_FORMAT`, `ERR_UNSUPPORTED_FORMAT`, `ERR_TRUNCATED`, or `ERR_IO`.
- Lossless JPEG (SOF3) is a candidate with `decodable: false`, not an error.
- Default `maxBytes` is 8 MiB; oversized candidates are skipped, never thrown.
- Re-encoded previews use `origin: "reencoded"` and `mimeType: "image/jpeg"`.

## Adding a format

A format ships only with a redistributable fixture (CC0 / public domain / permissive test-suite license) that has a `decodable: true` preview. That preview may be stored JPEG/PNG or produced by decode + JPEG-encode.

1. Add the id to `FormatId` in `src/types.ts`.
2. Detect it in `src/sniff.ts` (more-specific signatures before generic TIFF).
3. New file `src/formats/<id>.ts` exporting `matches` and `extract`.
4. Register it in `src/registry.ts` (`supportedFormats` order matches the object keys).
5. Catalog the sample under a new key in `scripts/fixtures.yaml` (`id`, `filename`, `url`, `bytes`, `sha256`, `license`, `source`, `previews`).
6. Cover it from tests: TIFF/DNG/CR2 have dedicated files under `test/formats/`; other formats go in the `FORMATS` list in `test/formats/more.test.mjs`.
7. `npm run fixtures` then `npm run check`.

TIFF-container RAWs (DNG, CR2, NEF, ARW, PEF, ORF, RW2) should reuse `extractTiffPreviews` from `shared.ts`. JPEG reads EXIF IFD1. RAF, CR3, and PSD/PSB have their own parsers. HEIC/AVIF copy stored JPEG/PNG items, then fall back to `src/reencode.ts`.
