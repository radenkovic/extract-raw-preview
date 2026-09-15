# thumbnail-extractor

Extract the JPEG (or PNG) preview already embedded in TIFF, DNG, and Canon CR2 files. No full decode, no native dependencies, no re-encoding.

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
| `detectFormat(input)` | `"tiff" \| "dng" \| "cr2"`, or `undefined`. Reads at most 64 KiB. |

`extractThumbnail` options:

| Option | Default | Notes |
| --- | --- | --- |
| `format` | sniffed | Skip sniffing. |
| `prefer` | `"largest"` | Or `"smallest"`. Ranked by pixel count, then byte length. |
| `maxBytes` | `8 MiB` | Drops oversized candidates; never throws. |

```ts
type Thumbnail = {
  data: Uint8Array;       // copy of the stored bytes, never re-encoded
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

DNG and CR2 are TIFF containers; all three share one IFD walker.

Planned: JPEG (EXIF IFD1), CR3, NEF, ARW, RAF, ORF, RW2, PEF, PSD/PSB, HEIC/HEIF, AVIF. A format ships only once it has a verified fixture with a working preview.

## CLI

```
thumbnail-extractor <file> [options]

  -o, --output <path>   Write here (default: <name>.thumb.<ext> next to the source)
  --list                Print all candidates; write nothing
  --json                JSON on stdout (`data` omitted)
  --format <id>         Force tiff | dng | cr2
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
npm run typecheck
npm test             # fixtures:check + build + tests
```

Fixtures are pinned by URL, size, and SHA-256 in [`scripts/fixtures.yaml`](scripts/fixtures.yaml). `npm run fixtures:check` (run as `pretest`) fails unless every supported format has a verified on-disk sample with a decodable preview.

To add a format: one file in `src/formats/`, one line in `src/registry.ts`, and a redistributable fixture (CC0 / public domain / permissive test-suite license) under a new key in the YAML catalog. To add a sample to an existing format, append an entry under that format's list.

## License

[MIT](LICENSE.md)
