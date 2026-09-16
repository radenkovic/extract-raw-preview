/**
 * Byte-oriented extraction shared by the Node and browser entry points.
 *
 * This module must stay free of Node built-ins so the browser bundle can load
 * it as-is.
 */

import { ExtractError } from "./errors.js";
import { Reader } from "./reader.js";
import { getExtractor } from "./registry.js";
import { SNIFF_BYTES, sniffFormat } from "./sniff.js";
import {
  type ExtractOptions,
  type ExtractResult,
  type FormatId,
  type Thumbnail,
  type ThumbnailCandidate,
  toThumbnail,
} from "./types.js";

/** Per-candidate byte cap default (SPEC §4.2). */
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Failure reasons (SPEC §3.2): lowercase and punctuation-free. */
const REASON = {
  none: "no embedded preview",
  losslessOnly: "only lossless-jpeg preview present",
  undecodable: "no decodable preview present",
  overCap: "all candidates exceed maxBytes",
} as const;

async function runExtractor(format: FormatId, bytes: Uint8Array): Promise<ThumbnailCandidate[]> {
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
    return {
      found: false,
      format,
      reason: onlyLossless ? REASON.losslessOnly : REASON.undecodable,
    };
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
 * Sniffs `bytes` by magic bytes and returns the detected `FormatId`, or
 * `undefined` if the bytes match no known signature. Looks at at most 64 KiB.
 */
export function detectFormatFromBytes(bytes: Uint8Array): FormatId | undefined {
  const head = bytes.length > SNIFF_BYTES ? bytes.subarray(0, SNIFF_BYTES) : bytes;
  return sniffFormat(head);
}

/**
 * Returns every embedded preview candidate, largest first, **without**
 * `maxBytes` filtering and **including** non-decodable candidates.
 */
export async function listThumbnailsFromBytes(bytes: Uint8Array): Promise<Thumbnail[]> {
  const format = sniffFormat(bytes);
  if (!format) {
    throw new ExtractError("ERR_UNRECOGNIZED_FORMAT", "input matched no known image signature");
  }
  const candidates = await runExtractor(format, bytes);
  return candidates.sort(byLargest).map(toThumbnail);
}

/**
 * Locates and returns the best embedded preview from already-resolved bytes.
 *
 * `maxBytes` is a per-candidate filter, not a hard error: an oversized candidate
 * is removed from consideration and never rejects the call (SPEC §4.2).
 */
export async function extractThumbnailFromBytes(
  bytes: Uint8Array,
  options: ExtractOptions = {},
): Promise<ExtractResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const prefer = options.prefer ?? "largest";

  const format = options.format ?? sniffFormat(bytes);
  if (!format) {
    throw new ExtractError("ERR_UNRECOGNIZED_FORMAT", "input matched no known image signature");
  }

  return select(format, await runExtractor(format, bytes), maxBytes, prefer);
}
