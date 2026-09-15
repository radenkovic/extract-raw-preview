# thumbnail-extractor

> Fast, dependency-light extraction of the embedded previews that camera formats
> carry inside their container — TIFF, DNG, and Canon CR2.

[![license](https://img.shields.io/npm/l/thumbnail-extractor.svg)](#license)

> **Status: pre-alpha.** The v0.1 API described here is implemented and tested
> against real camera files, but nothing has been published to npm yet.

## Why

Reading a 40 MB camera RAW file just to show a 256×171 grid thumbnail is
wasteful. Almost every professional format already contains one or more
pre-rendered JPEG previews written by the camera or converter.
`thumbnail-extractor` finds those bytes and hands them back — no full decode, no
native dependencies, no re-encoding.

When a file has no usable preview, the library says so plainly
(`{ found: false, reason }`) instead of quietly returning a full-size image.

## Features

- 🔍 **Format sniffing from magic bytes** — pass a path, a `file:` URL, or raw
  bytes; no need to declare the format.
- ⚡ **Bytes in, bytes out** — previews are returned exactly as stored, never
  re-encoded. Each result is a fresh `Uint8Array`, so nothing keeps the source
  file alive.
- 🧩 **Pluggable extractors** — one module per format; adding one is a new file
  plus a single line in the registry.
- 🪶 **No native build step.** Pure TypeScript, ESM, zero runtime dependencies.
- 🖼️ **Every candidate exposed** — `listThumbnails` returns all embedded
  previews, ranked, including ones a normal decoder cannot open.
- 🖥️ **CLI + programmatic API.**

## Install

```bash
npm install thumbnail-extractor
```

Requires Node.js 20+. Ships as **ESM only** (`"type": "module"`, no CommonJS
build). From CommonJS, use dynamic `import()`:

```js
const { extractThumbnail } = await import("thumbnail-extractor");
```

## Usage

```ts
import { extractThumbnail, listThumbnails } from "thumbnail-extractor";

// Extract the largest decodable embedded preview.
const result = await extractThumbnail("IMG_1234.CR2");

if (result.found) {
  console.log(result.format); // "cr2"
  console.log(result.width, result.height); // 1936 1288
  console.log(result.mimeType); // "image/jpeg"
  await fs.writeFile("thumb.jpg", result.data);
} else {
  console.log(result.reason); // e.g. "only lossless-jpeg preview present"
}
```

```ts
// Inspect every embedded candidate before choosing.
const candidates = await listThumbnails("photo.dng");
for (const c of candidates) {
  console.log(`${c.width}x${c.height} ${c.mimeType} ${c.byteLength}B decodable=${c.decodable}`);
  // => "5760x3840 image/jpeg 1235564B decodable=true"
  // => "3888x2592 image/jpeg 9578955B decodable=false"
}
```

### CLI

```bash
# Extract the largest preview next to the source file (photo.thumb.jpg)
npx thumbnail-extractor photo.cr2

# Write somewhere specific and print metadata as JSON
npx thumbnail-extractor photo.dng -o thumb.jpg --json

# List every embedded candidate without writing anything
npx thumbnail-extractor photo.tiff --list
```

## API

All functions are async and accept `string | URL | Uint8Array`. Relative paths
resolve against `process.cwd()`; only the `file:` URL scheme is supported.

### `extractThumbnail(input, options?): Promise<ExtractResult>`

Runs the pipeline: resolve → sniff → extract → filter → select.

| Param | Type | Description |
| --- | --- | --- |
| `input` | `string \| URL \| Uint8Array` | File path, `file:` URL, or raw bytes. |
| `options.format` | `FormatId` | Skip sniffing and force an extractor. |
| `options.maxBytes` | `number` | Per-candidate cap. Oversized candidates are dropped from consideration — never an error (default `8 MiB`). |
| `options.prefer` | `"largest" \| "smallest"` | Candidate selection strategy (default `"largest"`). |

Only `decodable` candidates are eligible for selection. `"largest"` picks the
greatest pixel count, breaking ties by greater `byteLength`; `"smallest"` is the
inverse.

### `listThumbnails(input): Promise<Thumbnail[]>`

Returns every embedded candidate, sorted by pixel count descending, with **no**
`maxBytes` filtering and **including** non-decodable entries. This is the
inspection API; `extractThumbnail` is the selection API.

### `detectFormat(input): Promise<FormatId | undefined>`

Returns the sniffed `FormatId`, or `undefined` when the bytes match no known
signature. Reads at most the first 64 KiB.

### Types

```ts
/** v0.1 formats. The union grows as roadmap formats ship. */
type FormatId = "tiff" | "dng" | "cr2";

type PreviewMimeType = "image/jpeg" | "image/png";
type ThumbnailOrigin = "embedded-jpeg" | "embedded-png";

type Thumbnail = {
  /** Raw preview bytes, exactly as stored; a copy, not a view. */
  data: Uint8Array;
  mimeType: PreviewMimeType;
  width: number;
  height: number;
  /** Byte length of `data`. Redundant but convenient for ranking/logging. */
  byteLength: number;
  origin: ThumbnailOrigin;
  /** False for e.g. lossless JPEG (SOF3) previews, which cannot be opened. */
  decodable: boolean;
};

type ExtractResult =
  | ({ found: true; format: FormatId } & Thumbnail)
  | { found: false; format: FormatId; reason: string };
```

## Failure vs. error

The API distinguishes outcomes from faults.

**Reportable outcomes** resolve with `{ found: false, format, reason }`:

| Reason | Meaning |
| --- | --- |
| `no embedded preview` | The container holds no preview at all. |
| `only lossless-jpeg preview present` | Previews exist but are lossless JPEG (SOF3). |
| `no decodable preview present` | Previews exist but none are openable. |
| `all candidates exceed maxBytes` | Everything was filtered out by the cap. |

**Operational errors** reject with an `Error` carrying a `code`:

| `code` | Condition |
| --- | --- |
| `ERR_UNRECOGNIZED_FORMAT` | Sniffing found no known signature and no `options.format` was given. |
| `ERR_TRUNCATED` | The file ends before a referenced structure. |
| `ERR_IO` | A path/URL input could not be read. |
| `ERR_UNSUPPORTED_FORMAT` | `options.format` names a format with no registered extractor. |

```ts
import { ExtractError } from "thumbnail-extractor";

try {
  await extractThumbnail("photo.cr2");
} catch (error) {
  if (error instanceof ExtractError) console.error(error.code, error.message);
}
```

## Supported formats

### v0.1

| Family | Extensions | Strategy |
| --- | --- | --- |
| TIFF | `.tif`, `.tiff` | IFD walk; JPEG compression (6/7) in strips or `JPEGInterchangeFormat` |
| DNG | `.dng` | `SubIFDs` of IFD0 carrying JPEG previews |
| Canon RAW 2 | `.cr2` | IFD chain (IFD0 → IFD3) plus the IFD1 `JPEGInterchangeFormat` thumbnail |

DNG and CR2 are TIFF containers, so one shared IFD walker underpins all three.

### Later

JPEG (EXIF `IFD1`), CR3, NEF, ARW, RAF, ORF, RW2, PEF, PSD/PSB, HEIC/HEIF, AVIF.

A format only counts as supported once it has a **verified fixture containing a
working preview** (same rule enforced by `npm run fixtures:check`).

## CLI reference

```
thumbnail-extractor <file> [options]

  -o, --output <path>   Write the selected preview here.
                        Default: <file-basename>.thumb.<ext> next to the source.
  --list                Print all candidates; write nothing.
  --json                Emit machine-readable JSON on stdout.
  --format <id>         Force a format, skip sniffing (tiff | dng | cr2).
  --prefer <strategy>   "largest" (default) | "smallest".
  --max-bytes <n>       Per-candidate cap (default 8388608).
  -h, --help            Usage.
```

- Human mode prints `path  WxH  mimeType  byteLength` per written file, or per
  candidate under `--list`.
- `--json` prints a single JSON value: the result with `data` omitted (plus
  `outputPath` when a file was written), or a candidate array under `--list`.
  A `{ found: false }` result is still valid JSON output.
- Diagnostics go to **stderr**, so `--json` stdout is always parseable.

| Exit code | Meaning |
| --- | --- |
| `0` | Success — including a `{ found: false }` result and `--list` with zero candidates (`[]`). |
| `1` | Operational error: unreadable file, unrecognized format, truncated file, write failure. |
| `2` | Usage error: unknown flag, missing argument. |

A `{ found: false }` result exits **0**: the tool worked, the file simply has no
usable preview. Scripts distinguish the cases via the JSON payload.

## Test fixtures

Real files are the only way to trust a format parser, so this project ships a
downloader instead of checked-in blobs. Fixtures land in `test/fixtures/`, which
is **gitignored** — the repository stays small and no sample is redistributed
without a read license.

```bash
npm run fixtures         # download anything missing, then verify
npm run fixtures:force   # re-download everything
npm run fixtures:check   # verify what is on disk (runs automatically before tests)
npm run fixtures:list    # print the manifest, download nothing
```

Every URL is hardcoded in [`scripts/fixtures.ts`](scripts/fixtures.ts) together
with the exact byte size and SHA-256, so a download either matches or fails
loudly.

| Fixture | Format | Source | Size | License | Previews |
| --- | --- | --- | --- | --- | --- |
| `tiff-child-ifd.tiff` | TIFF | Pillow test suite | 2.9 KiB | HPND | 3 baseline JPEGs (32×32, 16×16, 8×8) |
| `tiff-old-style-jpeg.tif` | TIFF | Pillow test suite | 209 KiB | HPND | 1 baseline JPEG (4160×870) |
| `tiff-kodak-dcs520c.tif` | TIFF | raw.pixls.us | 1.9 MiB | CC0-1.0 | *lossless* JPEG only (negative case) |
| `dng-canon-5d3-lossy.dng` | DNG | raw.pixls.us | 5.9 MiB | CC0-1.0 | 3 baseline JPEGs in SubIFDs |
| `cr2-canon-40d.cr2` | CR2 | raw.pixls.us | 10.4 MiB | CC0-1.0 | IFD0 JPEG + IFD1 thumbnail + lossless IFD3 raw |

The Kodak sample is deliberately kept as a negative case: a genuine camera TIFF
whose only preview is *lossless* JPEG (SOF3), which ordinary decoders cannot
open. It is why the extractor reports `decodable` honestly instead of assuming
every embedded JPEG is viewable.

### Acceptance criteria

`npm run fixtures:check` (run automatically via `pretest`) fails unless **every
supported format has at least one verified on-disk fixture containing a
decodable embedded preview**.

### Adding a fixture

1. Find a genuinely redistributable sample (CC0, Public Domain, or a permissive
   test-suite license).
2. Add an entry to `FIXTURES` in `scripts/fixtures.ts` with the URL, expected
   byte size, SHA-256, license, and the previews you expect to find.
3. Mark which previews are `decodable` — a format only counts as covered if at
   least one preview can actually be opened.

## Development

```bash
npm install
npm run fixtures     # real sample files (gitignored)
npm run typecheck    # tsc --noEmit
npm test             # fixtures:check + build + the test suite
```

Tests run on the built `dist/` output via Node's built-in test runner, and
expected widths/heights/byte lengths come from the `FIXTURES` manifest rather
than being hardcoded.

## Project layout

```
src/
  index.ts              # public API: extractThumbnail, listThumbnails, detectFormat
  sniff.ts              # magic-byte format detection
  reader.ts             # bounded cursor over Uint8Array
  ifd.ts                # shared TIFF IFD parser (both byte orders, CR2 header)
  jpeg.ts               # embedded-image identification (SOF parsing, no decoding)
  errors.ts             # ExtractError + codes
  registry.ts           # format id -> extractor
  types.ts              # public types
  cli.ts                # bin entry
  formats/
    shared.ts           # preview collection shared by TIFF containers
    tiff.ts
    dng.ts
    cr2.ts
scripts/
  fixtures.ts           # downloads + verifies real sample files
test/
  helpers.mjs           # manifest-driven expectations + shared fixtures
  api.test.mjs          # public API: inputs, errors, invariants
  cli.test.mjs          # CLI output shape and exit codes
  reader.test.mjs       # cursor bounds -> ERR_TRUNCATED
  sniff.test.mjs        # synthetic magic-byte detection
  formats/              # one module per extractor, mirroring src/formats/
    tiff.test.mjs
    dng.test.mjs
    cr2.test.mjs
  fixtures/             # downloaded, gitignored
```

## Design notes

1. **Sniff, then delegate.** The core identifies the format, then hands a reader
   to a format-specific extractor.
2. **Lazy reads.** Extractors skip to structures by offset instead of walking
   the container linearly, and never buffer more than they parse.
3. **Pure extractors.** A reader in, candidates out — no global state, trivially
   unit-testable.
4. **Bytes in, bytes out.** Previews are never decoded or re-encoded, and each
   one is copied exactly once out of the source buffer.
5. **TIFF-first.** DNG and CR2 are TIFF containers, so one well-tested IFD walker
   covers all three v0.1 formats and becomes the base for the roadmap.
6. **Honest failure.** `{ found: false, reason }` over silent fallbacks; full
   decode stays out of scope.
7. **Bounded probing.** A malformed optional structure is treated as absent;
   only a broken *required* structure (the root IFD) is an error.

## Contributing

Each format lives in `src/formats/<id>.ts` and exports a `matches(bytes)`
predicate plus an async `extract(reader)`. Adding a format should mean one file
and one line in `src/registry.ts`.

A format is only accepted once it has a **verified fixture with a working
preview**, so a new-format PR should extend `FIXTURES` in `scripts/fixtures.ts`
alongside the extractor. See [Adding a fixture](#adding-a-fixture).

## License

ISC
