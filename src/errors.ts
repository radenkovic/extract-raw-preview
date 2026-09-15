/**
 * Operational errors (SPEC §4.3).
 *
 * `thumbnail-extractor` separates *reportable outcomes* — which resolve as
 * `{ found: false, reason }` — from *operational errors*, which reject the
 * promise with an `Error` carrying one of these codes.
 */

export type ExtractErrorCode =
  | "ERR_UNRECOGNIZED_FORMAT"
  | "ERR_TRUNCATED"
  | "ERR_IO"
  | "ERR_UNSUPPORTED_FORMAT";

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;

  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
  }
}

export function isExtractError(value: unknown): value is ExtractError {
  return value instanceof ExtractError;
}

/** Bounds violation on a *required* structure (SPEC §5.2). */
export function truncated(message: string): ExtractError {
  return new ExtractError("ERR_TRUNCATED", message);
}
