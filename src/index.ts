/**
 * Public API (SPEC §4).
 *
 * `detectFormat` sniffs, `listThumbnails` inspects, `extractThumbnail` selects.
 * Reportable outcomes (`{ found: false, reason }`) resolve; operational errors
 * reject with an `ExtractError` carrying a `code` (SPEC §4.3).
 */

import { open, readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { ExtractError } from "./errors.js";
import { Reader } from "./reader.js";
import { getExtractor } from "./registry.js";
import { SNIFF_BYTES, sniffFormat } from "./sniff.js";
import {
  toThumbnail,
  type ExtractInput,
  type ExtractOptions,
  type ExtractResult,
  type FormatId,
  type Thumbnail,
  type ThumbnailCandidate,
} from "./types.js";

export type {
  ExtractInput,
  ExtractOptions,
  ExtractResult,
  FormatId,
  PreviewMimeType,
  Thumbnail,
  ThumbnailOrigin,
} from "./types.js";
export type { ExtractErrorCode } from "./errors.js";
export { ExtractError, isExtractError } from "./errors.js";
export { Reader } from "./reader.js";
export { supportedFormats } from "./registry.js";
export { SNIFF_BYTES } from "./sniff.js";

/** Per-candidate byte cap default (SPEC §4.2). */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Failure reasons (SPEC §3.2): lowercase and punctuation-free. */
const REASON = {
  none: "no embedded preview",
  losslessOnly: "only lossless-jpeg preview present",
  undecodable: "no decodable preview present",
  overCap: "all candidates exceed maxBytes",
} as const;

function isByteInput(input: ExtractInput): input is Uint8Array {
  return input instanceof Uint8Array;
}

function pathFromUrl(url: URL): string {
  if (url.protocol !== "file:") {
    throw new ExtractError(
      "ERR_IO",
      `unsupported URL scheme "${url.protocol}" — only file: is supported`,
    );
  }
  try {
    return fileURLToPath(url);
  } catch (error) {
    throw new ExtractError("ERR_IO", `invalid file URL: ${(error as Error).message}`);
  }
}

async function readFileBytes(path: string): Promise<Uint8Array> {
  try {
    return await readFile(path);
  } catch (error) {
    throw new ExtractError("ERR_IO", `could not read ${path}: ${(error as Error).message}`);
  }
}

/** Resolves any accepted input to bytes (SPEC §4.4). Bytes are used as-is. */
async function resolveBytes(input: ExtractInput): Promise<Uint8Array> {
  if (isByteInput(input)) return input;
  if (typeof input === "string") return readFileBytes(resolvePath(input));
  if (input instanceof URL) return readFileBytes(pathFromUrl(input));
  throw new ExtractError(
    "ERR_IO",
    "input must be a filesystem path, a file: URL, or a Uint8Array",
  );
}

/** Resolves input to at most the first 64 KiB, for sniffing only (SPEC §4.1). */
async function resolveSniffBytes(input: ExtractInput): Promise<Uint8Array> {
  if (isByteInput(input)) {
    return input.length > SNIFF_BYTES ? input.subarray(0, SNIFF_BYTES) : input;
  }

  const path = typeof input === "string" ? resolvePath(input) : pathFromUrl(input);
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    throw new ExtractError("ERR_IO", `could not open ${path}: ${(error as Error).message}`);
  }

  try {
    const buffer = new Uint8Array(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return bytesRead === buffer.length ? buffer : buffer.subarray(0, bytesRead);
  } catch (error) {
    throw new ExtractError("ERR_IO", `could not read ${path}: ${(error as Error).message}`);
  } finally {
    await handle.close();
  }
}

async function runExtractor(
  format: FormatId,
  bytes: Uint8Array,
): Promise<ThumbnailCandidate[]> {
  const extractor = getExtractor(format);
  if (!extractor) {
    throw new ExtractError(
      "ERR_UNSUPPORTED_FORMAT",
      `no extractor is registered for format "${format}"`,
    );
  }
  return extractor.extract(new Reader(bytes));
}

/** Pixel count descending, ties by byte length descending. */
function byLargest(a: ThumbnailCandidate, b: ThumbnailCandidate): number {
  return b.width * b.height - a.width * a.height || b.byteLength - a.byteLength;
}

/** Pixel count ascending, ties by byte length ascending. */
function bySmallest(a: ThumbnailCandidate, b: ThumbnailCandidate): number {
  return a.width * a.height - b.width * b.height || a.byteLength - b.byteLength;
}

/**
 * Sniffs `input` by magic bytes and returns the detected `FormatId`, or
 * `undefined` if the bytes match no known signature.
 */
export async function detectFormat(input: ExtractInput): Promise<FormatId | undefined> {
  return sniffFormat(await resolveSniffBytes(input));
}

/**
 * Returns every embedded preview candidate, largest first, **without**
 * `maxBytes` filtering and **including** non-decodable candidates.
 */
export async function listThumbnails(input: ExtractInput): Promise<Thumbnail[]> {
  const bytes = await resolveBytes(input);
  const format = sniffFormat(bytes);
  if (!format) {
    throw new ExtractError(
      "ERR_UNRECOGNIZED_FORMAT",
      "input matched no known image signature",
    );
  }
  const candidates = await runExtractor(format, bytes);
  return candidates.sort(byLargest).map(toThumbnail);
}

function select(
  format: FormatId,
  candidates: readonly ThumbnailCandidate[],
  maxBytes: number,
  prefer: "largest" | "smallest",
): ExtractResult {
  if (candidates.length === 0) {
    return { found: false, format, reason: REASON.none };
  }

  // Precedence (SPEC §4.2 step 5): none present > all non-decodable > all over cap.
  if (!candidates.some((candidate) => candidate.decodable)) {
    const onlyLossless = candidates.every((candidate) => candidate.kind === "lossless-jpeg");
    return { found: false, format, reason: onlyLossless ? REASON.losslessOnly : REASON.undecodable };
  }

  const eligible = candidates.filter(
    (candidate) => candidate.decodable && candidate.byteLength <= maxBytes,
  );
  if (eligible.length === 0) {
    return { found: false, format, reason: REASON.overCap };
  }

  eligible.sort(prefer === "smallest" ? bySmallest : byLargest);
  const chosen = eligible[0];
  return {
    found: true,
    format,
    data: chosen.data,
    mimeType: chosen.mimeType,
    width: chosen.width,
    height: chosen.height,
    byteLength: chosen.byteLength,
    origin: chosen.origin,
    decodable: chosen.decodable,
  };
}

/**
 * Locates and returns the best embedded preview.
 *
 * `maxBytes` is a per-candidate filter, not a hard error: an oversized candidate
 * is removed from consideration and never rejects the call (SPEC §4.2).
 */
export async function extractThumbnail(
  input: ExtractInput,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const prefer = options.prefer ?? "largest";

  const bytes = await resolveBytes(input);
  const format = options.format ?? sniffFormat(bytes);
  if (!format) {
    throw new ExtractError(
      "ERR_UNRECOGNIZED_FORMAT",
      "input matched no known image signature",
    );
  }

  return select(format, await runExtractor(format, bytes), maxBytes, prefer);
}
