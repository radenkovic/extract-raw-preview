# thumbnail-extractor

Extract JPEG or PNG thumbnails from RAW, DNG, TIFF, JPEG, CR3, PSD, PSB, HEIC, and AVIF files.

Stored JPEG/PNG bytes are copied when the container has them. When the only preview is HEVC or AV1 (typical HEIC/AVIF), that image is decoded and JPEG-encoded. Runtime dependencies are used for those decode/encode paths (`libheif-js`, `sharp`).

**Pre-alpha.** The API below works and is tested against real camera files, but the package is not on npm yet.

Requires **Node.js 20+**. ESM only.

```bash
npm install thumbnail-extractor
```

## Usage

```ts
import { extractThumbnail, listThumbnails } from "thumbnail-extractor";

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

```bash
npx thumbnail-extractor photo.cr2                 # writes photo.thumb.jpg
npx thumbnail-extractor photo.dng -o thumb.jpg --json
npx thumbnail-extractor photo.tiff --list         # inspect, write nothing
```

Input can be a path, a `file:` URL, or a `Uint8Array`. Format is sniffed from magic bytes.

## API

All functions are async.

| Function | Returns |
| --- | --- |
| `extractThumbnail(input, options?)` | The best **decodable** preview, or `{ found: false, reason }` |
| `listThumbnails(input)` | Every candidate, largest first — including non-decodable ones. No `maxBytes` filter. |
| `detectFormat(input)` | `"tiff" \| "dng" \| "cr2" \| "jpeg" \| "nef" \| "arw" \| "raf" \| "orf" \| "rw2" \| "pef" \| "cr3" \| "psd" \| "psb" \| "heic" \| "avif"`, or `undefined`. Reads at most 64 KiB. |

`extractThumbnail` options:

| Option | Default | Notes |
| --- | --- | --- |
| `format` | sniffed | Skip sniffing. |
| `prefer` | `"largest"` | Or `"smallest"`. Ranked by pixel count, then byte length. |
| `maxBytes` | `8 MiB` | Drops oversized candidates; never throws. |

```ts
type Thumbnail = {
  data: Uint8Array;       // stored JPEG/PNG copy, or JPEG from HEVC/AV1 decode
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  byteLength: number;
  origin: "embedded-jpeg" | "embedded-png" | "reencoded";
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
import { ExtractError } from "thumbnail-extractor";

try {
  await extractThumbnail("photo.cr2");
} catch (error) {
  if (error instanceof ExtractError) console.error(error.code, error.message);
}
```

## Formats

| Format | Extensions |
| --- | --- |
| TIFF | `.tif`, `.tiff` |
| DNG | `.dng` |
| Canon RAW 2 | `.cr2` |
| JPEG | `.jpg`, `.jpeg` |
| Nikon NEF | `.nef` |
| Sony ARW | `.arw` |
| Fujifilm RAF | `.raf` |
| Olympus ORF | `.orf` |
| Panasonic RW2 | `.rw2` |
| Pentax PEF | `.pef` |
| Canon RAW 3 | `.cr3` |
| Photoshop | `.psd` |
| Photoshop Large | `.psb` |
| HEIC / HEIF | `.heic`, `.heif`, `.hif` |
| AVIF | `.avif` |

TIFF-container RAWs (DNG, CR2, NEF, ARW, PEF, ORF, RW2) share one IFD walker. JPEG reads EXIF IFD1; RAF, CR3, and PSD/PSB have their own parsers. HEIC and AVIF copy stored JPEG/PNG items when present; otherwise the HEVC or AV1 image is decoded and JPEG-encoded.

## Dependencies

`libheif-js` (WASM) decodes HEVC in HEIC/HEIF. `sharp` (native libvips) decodes AVIF and JPEG-encodes re-encoded previews. Both are runtime dependencies; `sharp` installs a platform binary via `npm ci`.

`origin: "reencoded"` marks those JPEGs. Copied previews stay `embedded-jpeg` or `embedded-png`.

## CLI

```
thumbnail-extractor <file> [options]

  -o, --output <path>   Write here (default: <name>.thumb.<ext> next to the source)
  --list                Print all candidates; write nothing
  --json                JSON on stdout (`data` omitted)
  --format <id>         Force tiff | dng | cr2 | jpeg | nef | arw | raf | orf | rw2 | pef | cr3 | psd | psb | heic | avif
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

To add a format: one file in `src/formats/`, one line in `src/registry.ts`, and a redistributable fixture (CC0 / public domain / permissive test-suite license) under a new key in the YAML catalog. The preview may be stored JPEG/PNG or produced by decode + JPEG-encode. Runtime dependencies are fine when they unlock the format. To add a sample to an existing format, append an entry under that format's list.

## License

[MIT](LICENSE.md). HEVC decode uses `libheif-js` (LGPL-3.0); AVIF decode and JPEG encode use `sharp` (Apache-2.0).
