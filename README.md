# extract-raw-preview — camera RAW thumbnail extractor

[![npm version](https://img.shields.io/npm/v/extract-raw-preview)](https://www.npmjs.com/package/extract-raw-preview)
[![npm downloads](https://img.shields.io/npm/dm/extract-raw-preview)](https://www.npmjs.com/package/extract-raw-preview)
[![CI](https://github.com/radenkovic/extract-raw-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/radenkovic/extract-raw-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/node/v/extract-raw-preview)](https://nodejs.org)

A zero-dependency JavaScript and TypeScript library for extracting embedded JPEG and PNG thumbnails from camera RAW images. It supports Canon CR2/CR3, Nikon NEF, Sony ARW, Fujifilm RAF, Adobe DNG, Olympus ORF, Panasonic RW2, Pentax PEF, TIFF, JPEG EXIF thumbnails, and Photoshop PSD/PSB files in **Node.js and the browser**.

```bash
npm install extract-raw-preview
```

## Why use it?

- **Fast previews without RAW decoding** — copies the camera's embedded preview instead of demosaicing sensor data.
- **Browser and Node.js support** — process a local upload client-side, or read a path, `file:` URL, or bytes on a server.
- **No native addons, WASM, binaries, or runtime dependencies** — pure ESM JavaScript with TypeScript declarations.
- **Library and CLI** — use the async API or run `npx extract-raw-preview photo.cr3`.
- **Multiple candidates** — select the largest or smallest decodable preview, enforce a byte limit, or inspect every embedded thumbnail.

Use it to create photo-upload previews, RAW contact sheets, gallery and digital asset management thumbnails, file-manager previews, or fast ingestion pipelines. The image is returned exactly as stored: there is no pixel decode, re-encode, or resize, and the API does not extract or expose general EXIF metadata.

Unlike ExifTool- or LibRaw-based tools, `extract-raw-preview` walks each container itself (TIFF IFDs, CR3 BMFF, RAF headers, and PSD image resources). This keeps it portable enough for client-side browser apps and serverless JavaScript environments.

Supported containers:

- **TIFF-family RAW** — Adobe DNG, Canon CR2, Nikon NEF, Sony ARW, Olympus ORF, Panasonic RW2, Pentax PEF, and generic TIFF
- **Other containers** — Fujifilm RAF, Canon CR3, JPEG (EXIF thumbnail), Photoshop PSD and PSB

> Need decoded pixels, white balance, resizing, or support for every camera format? Use a full RAW decoder such as LibRaw instead. This package is intentionally focused on quickly extracting an existing JPEG or PNG preview.

## Quick start

### Node.js

```ts
import { writeFile } from "node:fs/promises";
import { extractThumbnail, listThumbnails } from "extract-raw-preview";

const result = await extractThumbnail("IMG_1234.CR2");

if (result.found) {
  await writeFile("thumb.jpg", result.data); // 1936×1288 JPEG, as stored
} else {
  console.log(result.reason); // e.g. "only lossless-jpeg preview present"
}

const candidates = await listThumbnails("photo.dng");
// 5760×3840 image/jpeg 1235564B decodable=true
// 3888×2592 image/jpeg 9578955B decodable=false
```

### Browser

Pass the file bytes from an `<input type="file">` or drag-and-drop event. Bundlers pick the browser build automatically, with no `node:fs` or native addons:

```ts
import { extractThumbnail } from "extract-raw-preview";

const bytes = new Uint8Array(await file.arrayBuffer());
const result = await extractThumbnail(bytes);

if (result.found) {
  const image = document.querySelector("img");

  if (image) {
    const blob = new Blob([Uint8Array.from(result.data)], { type: result.mimeType });
    const previewUrl = URL.createObjectURL(blob);
    image.addEventListener("load", () => URL.revokeObjectURL(previewUrl), { once: true });
    image.src = previewUrl;
  }
}
```

### Command line

```bash
npx extract-raw-preview photo.cr2                 # writes photo.thumb.jpg
npx extract-raw-preview photo.dng -o thumb.jpg --json
npx extract-raw-preview photo.tiff --list         # inspect, write nothing
```

Input can be a path, a `file:` URL, or a `Uint8Array`. Format is sniffed from magic bytes. Paths and `file:` URLs are Node-only.

## RAW preview extraction vs. RAW conversion

Most camera RAW files contain one or more ready-made JPEG previews for camera playback and cataloging. This package extracts those embedded bytes, which is much faster and lighter than decoding the sensor data. It does **not** demosaic, color-correct, resize, or convert a RAW image to JPEG. For full RAW-to-JPEG conversion, use a native or WebAssembly RAW decoder.

## API

All functions are async.

| Function | Returns |
| --- | --- |
| `extractThumbnail(input, options?)` | The best **decodable** preview, or `{ found: false, reason }` |
| `listThumbnails(input)` | Every candidate, largest first — including non-decodable ones. No `maxBytes` filter. |
| `detectFormat(input)` | A `FormatId` from the table below, or `undefined`. Reads at most 64 KiB. |

`extractThumbnail` options:

| Option | Default | Notes |
| --- | --- | --- |
| `format` | sniffed | Skip sniffing. |
| `prefer` | `"largest"` | Or `"smallest"`. Ranked by pixel count, then byte length. |
| `maxBytes` | `8 MiB` | Drops oversized candidates; never throws. |

```ts
type Thumbnail = {
  data: Uint8Array;       // stored JPEG/PNG copy
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  byteLength: number;
  origin: "embedded-jpeg" | "embedded-png";
  decodable: boolean;     // false for lossless JPEG (SOF3)
};

type ExtractResult =
  | ({ found: true; format: FormatId } & Thumbnail)
  | { found: false; format: FormatId; reason: string };
```

### Missing preview vs. error

A file with no usable preview **resolves**:

| `reason` | Meaning |
| --- | --- |
| `no embedded preview` | Nothing embedded. |
| `only lossless-jpeg preview present` | Previews exist but are SOF3. |
| `no decodable preview present` | Previews exist but none open. |
| `all candidates exceed maxBytes` | Everything was over the cap. |

Broken input **rejects** with `ExtractError`:

| `code` | When |
| --- | --- |
| `ERR_UNRECOGNIZED_FORMAT` | Unknown signature and no `options.format`. |
| `ERR_UNSUPPORTED_FORMAT` | `options.format` has no extractor. |
| `ERR_TRUNCATED` | File ends before a required structure. |
| `ERR_IO` | Path/URL could not be read. |

```ts
import { ExtractError } from "extract-raw-preview";

try {
  await extractThumbnail("photo.cr2");
} catch (error) {
  if (error instanceof ExtractError) console.error(error.code, error.message);
}
```

## Formats

Format is sniffed from magic bytes (first 64 KiB), not the filename. Pass `format` / `--format` with the **id** below to skip sniffing.

| Id | Format | Extensions | Where the preview lives |
| --- | --- | --- | --- |
| `tiff` | TIFF | `.tif`, `.tiff` | JPEG-compressed IFDs and SubIFDs |
| `dng` | Adobe DNG | `.dng` | Reduced-resolution JPEG SubIFDs |
| `cr2` | Canon RAW 2 | `.cr2` | IFD JPEG strips plus a `JPEGInterchangeFormat` thumbnail |
| `nef` | Nikon NEF | `.nef` | SubIFDs or `JPEGInterchangeFormat` |
| `arw` | Sony ARW | `.arw` | `JPEGInterchangeFormat` on IFD0 / IFD1 |
| `orf` | Olympus ORF | `.orf` | IFD1 `JPEGInterchangeFormat` |
| `rw2` | Panasonic RW2 | `.rw2` | Panasonic `JpgFromRaw`, plus its nested EXIF thumbnail |
| `pef` | Pentax PEF | `.pef` | `JPEGInterchangeFormat` on later IFDs |
| `jpeg` | JPEG | `.jpg`, `.jpeg` | EXIF IFD1 thumbnail (the primary image is not a preview) |
| `raf` | Fujifilm RAF | `.raf` | Header JPEG, plus any nested EXIF thumbnail |
| `cr3` | Canon RAW 3 | `.cr3` | BMFF `THMB`, Canon `uuid`, and `mdat` JPEGs |
| `psd` | Photoshop | `.psd` | Image resource 1036 (JPEG thumbnail) |
| `psb` | Photoshop Large | `.psb` | Same resource layout as PSD |

TIFF-container RAWs (DNG, CR2, NEF, ARW, PEF, ORF, RW2) share one IFD walker. JPEG reads EXIF IFD1; RAF, CR3, and PSD/PSB have their own parsers. Lossless JPEG (SOF3) previews are listed with `decodable: false` and are never returned by `extractThumbnail`.

## CLI

```
extract-raw-preview <file> [options]

  -o, --output <path>   Write here (default: <name>.thumb.<ext> next to the source)
  --list                Print all candidates; write nothing
  --json                JSON on stdout (`data` omitted)
  --format <id>         Force a format id from the table above
  --prefer <strategy>   largest (default) | smallest
  --max-bytes <n>       Per-candidate cap (default 8388608)
  -h, --help
```

Human mode prints `path  WxH  mimeType  byteLength`. Diagnostics go to stderr, so `--json` stdout stays parseable.

| Exit | Meaning |
| --- | --- |
| `0` | Success, including `{ found: false }` and `--list` with no candidates |
| `1` | Operational error (unreadable, unrecognized, truncated, write failure) |
| `2` | Bad flags or missing arguments |

## Development

```bash
npm install
npm run fixtures     # download real samples into test/fixtures/ (gitignored)
npm run fixtures:thumbs  # extract previews into test/fixtures/thumbs/
npm run lint         # biome format + lint
npm run typecheck
npm test             # fixtures:check + build + tests
```

Fixtures are pinned by URL, size, and SHA-256 in [`scripts/fixtures.yaml`](scripts/fixtures.yaml). `npm run fixtures:check` (run as `pretest`) fails unless every supported format has a verified on-disk sample with a decodable preview.

To add a format: one file in `src/formats/`, one line in `src/registry.ts`, and a redistributable fixture (CC0 / public domain / permissive test-suite license) under a new key in the YAML catalog. The preview must be stored JPEG or PNG bytes — this library copies them and does not decode pixels. To add a sample to an existing format, append an entry under that format's list.

## Releasing

Versioning uses [Changesets](https://changesets.dev). See [RELEASING.md](RELEASING.md) for the PR flow, the first `1.0.0` publish, and npm trusted publishing.

## License

[MIT](LICENSE.md) © [Dan Radenkovic](https://radenkovic.org)
