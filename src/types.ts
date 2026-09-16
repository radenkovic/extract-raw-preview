/**
 * Public types (SPEC §3).
 *
 * The v0.1 `FormatId` union is closed on purpose: `ERR_UNSUPPORTED_FORMAT`
 * remains reachable at runtime for untyped callers, but typed callers cannot
 * name a format that has no registered extractor.
 */

/** Supported formats. Union grows as roadmap formats ship. */
export type FormatId =
  | "tiff"
  | "dng"
  | "cr2"
  | "jpeg"
  | "nef"
  | "arw"
  | "raf"
  | "orf"
  | "rw2"
  | "pef"
  | "cr3"
  | "psd"
  | "psb"
  | "heic"
  | "avif";

/** MIME type of returned preview bytes. */
export type PreviewMimeType = "image/jpeg" | "image/png";

/** How the preview bytes were produced: copied from the container, or decoded and JPEG-encoded. */
export type ThumbnailOrigin = "embedded-jpeg" | "embedded-png" | "reencoded";

interface ThumbnailShape {
  /** Preview bytes: a copy of stored JPEG/PNG, or a JPEG produced by re-encoding. */
  data: Uint8Array;
  mimeType: PreviewMimeType;
  width: number;
  height: number;
  /** Byte length of `data`. Redundant but convenient for ranking/logging. */
  byteLength: number;
  /** Where the bytes came from: copied from the container, or decoded then JPEG-encoded. */
  origin: ThumbnailOrigin;
  /**
   * True when a standard image decoder can open these bytes.
   * False for e.g. lossless JPEG (SOF3) previews.
   */
  decodable: boolean;
}

export type Thumbnail = ThumbnailShape;

export type ExtractResult =
  | ({ found: true; format: FormatId } & Thumbnail)
  | { found: false; format: FormatId; reason: string };

export interface ExtractOptions {
  /** Skip sniffing; force a specific extractor. */
  format?: FormatId;
  /** Per-candidate byte cap. See SPEC §4.2. Default 8 MiB. */
  maxBytes?: number;
  /** Selection strategy across candidates. Default "largest". */
  prefer?: "largest" | "smallest";
}

/** Accepted input forms (SPEC §4.4). */
export type ExtractInput = string | URL | Uint8Array;

/**
 * JPEG flavour of a candidate. Not part of the public `Thumbnail`: it exists so
 * failure reasons can distinguish "only lossless previews" from the generic
 * "nothing decodable" case (SPEC §3.2).
 */
export type EmbeddedImageKind =
  | "baseline-jpeg"
  | "progressive-jpeg"
  | "lossless-jpeg"
  | "other-jpeg"
  | "png";

/**
 * Internal type (SPEC §5.1): a `Thumbnail` plus the provenance ranking and
 * reason-reporting need. Stripped to `Thumbnail` before leaving the library.
 */
export interface ThumbnailCandidate extends Thumbnail {
  kind: EmbeddedImageKind;
}

/** Drops internal provenance, leaving exactly the public shape. */
export function toThumbnail(candidate: ThumbnailCandidate): Thumbnail {
  return {
    data: candidate.data,
    mimeType: candidate.mimeType,
    width: candidate.width,
    height: candidate.height,
    byteLength: candidate.byteLength,
    origin: candidate.origin,
    decodable: candidate.decodable,
  };
}
