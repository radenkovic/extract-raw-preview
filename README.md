# extract-raw-preview

[![npm version](https://img.shields.io/npm/v/extract-raw-preview)](https://www.npmjs.com/package/extract-raw-preview)
[![CI](https://github.com/radenkovic/extract-raw-preview/actions/workflows/ci.yml/badge.svg)](https://github.com/radenkovic/extract-raw-preview/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.md)
[![Node.js](https://img.shields.io/node/v/extract-raw-preview)](https://nodejs.org)

Extract embedded JPEG and PNG previews from camera RAW files — Canon CR2/CR3, Nikon NEF, Sony ARW, Fujifilm RAF, Adobe DNG, Olympus ORF, Panasonic RW2, Pentax PEF — plus TIFF, JPEG EXIF thumbnails, and Photoshop PSD/PSB.

Cameras and editors store a displayable preview so you can show a thumbnail without decoding mosaiced sensor data. This library copies those stored bytes as they appear in the container. No pixel decode, no re-encode, no native RAW decoder, no runtime dependencies. Same API in **Node.js 20+** (a path, a `file:` URL, or bytes) and in the **browser** (`Uint8Array` only). ESM only.

Unlike ExifTool-based tools, it walks the container itself (TIFF IFDs, CR3 BMFF, RAF header, PSD image resources), so it also runs in the browser.

It currently extracts previews from:

- **TIFF-family RAW** — Adobe DNG, Canon CR2, Nikon NEF, Sony ARW, Olympus ORF, Panasonic RW2, Pentax PEF, and generic TIFF
- **Other containers** — Fujifilm RAF, Canon CR3, JPEG (EXIF thumbnail), Photoshop PSD and PSB

```bash
npm install extract-raw-preview
```

## Usage

```ts
import { extractThumbnail, listThumbnails } from "extract-raw-preview";

const result = await extractThumbnail("IMG_1234.CR2");

if (result.found) {
  await fs.writeFile("thumb.jpg", result.data); // 1936×1288 JPEG, as stored
} else {
  console.log(result.reason); // e.g. "only lossless-jpeg preview present"
}

const candidates = await listThumbnails("photo.dng");
// 5760×3840 image/jpeg 1235564B decodable=true
// 3888×2592 image/jpeg 9578955B decodable=false
```

In the browser, pass the file bytes. Bundlers pick the browser build automatically (no `node:fs`, no native addons):

```ts
import { extractThumbnail } from "extract-raw-preview";

const bytes = new Uint8Array(await file.arrayBuffer());
const result = await extractThumbnail(bytes);
```

```bash
npx extract-raw-preview photo.cr2                 # writes photo.thumb.jpg
npx extract-raw-preview photo.dng -o thumb.jpg --json
npx extract-raw-preview photo.tiff --list         # inspect, write nothing
```

Input can be a path, a `file:` URL, or a `Uint8Array`. Format is sniffed from magic bytes. Paths and `file:` URLs are Node-only.

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

## License

[MIT](LICENSE.md) © [Dan Radenkovic](https://radenkovic.org)
