#!/usr/bin/env node
/**
 * CLI (SPEC §7).
 *
 * Exit codes: 0 success (including a `{ found: false }` result), 1 operational
 * error, 2 usage error. Diagnostics go to stderr so `--json` stdout is always a
 * single parseable JSON value.
 */

import { writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

import { ExtractError } from "./errors.js";
import { DEFAULT_MAX_BYTES, extractThumbnail, listThumbnails } from "./index.js";
import { isFormatId, supportedFormats } from "./registry.js";
import type { FormatId, Thumbnail } from "./types.js";

const USAGE = `Usage: thumbnail-extractor <file> [options]

Options:
  -o, --output <path>   Write the selected preview here.
                        Default: <file-basename>.thumb.<ext> next to the source.
  --list                Print all candidates; write nothing.
  --json                Emit machine-readable JSON on stdout.
  --format <id>         Force a format, skip sniffing (${supportedFormats.join(" | ")}).
  --prefer <strategy>   "largest" (default) | "smallest".
  --max-bytes <n>       Per-candidate cap (default ${DEFAULT_MAX_BYTES}).
  -h, --help            Usage.`;

class UsageError extends Error {}

interface CliOptions {
  file?: string;
  output?: string;
  list: boolean;
  json: boolean;
  format?: FormatId;
  prefer: "largest" | "smallest";
  maxBytes: number;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    list: false,
    json: false,
    prefer: "largest",
    maxBytes: DEFAULT_MAX_BYTES,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case "-o":
      case "--output": {
        const value = argv[++i];
        if (value === undefined) throw new UsageError(`${arg} requires a path`);
        options.output = value;
        break;
      }
      case "--list":
        options.list = true;
        break;
      case "--json":
        options.json = true;
        break;
      case "--format": {
        const value = argv[++i];
        if (value === undefined) throw new UsageError("--format requires an id");
        if (!isFormatId(value)) {
          throw new UsageError(
            `unknown format "${value}" (expected ${supportedFormats.join(" | ")})`,
          );
        }
        options.format = value;
        break;
      }
      case "--prefer": {
        const value = argv[++i];
        if (value !== "largest" && value !== "smallest") {
          throw new UsageError('--prefer requires "largest" or "smallest"');
        }
        options.prefer = value;
        break;
      }
      case "--max-bytes": {
        const value = argv[++i];
        const parsed = Number(value);
        if (value === undefined || !Number.isInteger(parsed) || parsed < 0) {
          throw new UsageError("--max-bytes requires a non-negative integer");
        }
        options.maxBytes = parsed;
        break;
      }
      default: {
        if (arg.startsWith("-") && arg !== "-") throw new UsageError(`unknown flag "${arg}"`);
        if (options.file !== undefined) {
          throw new UsageError(`unexpected extra argument "${arg}"`);
        }
        options.file = arg;
      }
    }
  }

  return options;
}

/** `<dir>/<stem>.thumb.<ext>` next to the source file. */
function defaultOutputPath(source: string, mimeType: string): string {
  const extension = mimeType === "image/png" ? "png" : "jpg";
  const absolute = resolve(source);
  const stem = basename(absolute, extname(absolute));
  return join(dirname(absolute), `${stem}.thumb.${extension}`);
}

/** Public shape minus the raw bytes, for JSON output. */
function withoutData(thumbnail: Thumbnail): Omit<Thumbnail, "data"> {
  const { data: _data, ...rest } = thumbnail;
  return rest;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function runList(file: string, options: CliOptions): Promise<number> {
  if (options.format !== undefined) {
    process.stderr.write("note: --format is ignored with --list\n");
  }
  const candidates = await listThumbnails(file);
  if (options.json) {
    print(JSON.stringify(candidates.map(withoutData)));
  } else {
    for (const candidate of candidates) {
      print(`${file}  ${candidate.width}x${candidate.height}  ${candidate.mimeType}  ${candidate.byteLength}`);
    }
  }
  return 0;
}

async function runExtract(file: string, options: CliOptions): Promise<number> {
  const result = await extractThumbnail(file, {
    format: options.format,
    maxBytes: options.maxBytes,
    prefer: options.prefer,
  });

  if (!result.found) {
    if (options.json) {
      print(JSON.stringify(result));
    } else {
      process.stderr.write(`no preview extracted: ${result.reason}\n`);
    }
    return 0;
  }

  const outputPath = options.output ?? defaultOutputPath(file, result.mimeType);
  try {
    await writeFile(outputPath, result.data);
  } catch (error) {
    throw new ExtractError(
      "ERR_IO",
      `could not write ${outputPath}: ${(error as Error).message}`,
    );
  }

  if (options.json) {
    print(JSON.stringify({ ...withoutData(result), outputPath }));
  } else {
    print(`${outputPath}  ${result.width}x${result.height}  ${result.mimeType}  ${result.byteLength}`);
  }
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    print(USAGE);
    return 0;
  }

  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`${error.message}\n\n${USAGE}\n`);
      return 2;
    }
    throw error;
  }

  const file = options.file;
  if (file === undefined) {
    process.stderr.write(`missing input file\n\n${USAGE}\n`);
    return 2;
  }

  try {
    return options.list ? await runList(file, options) : await runExtract(file, options);
  } catch (error) {
    if (error instanceof ExtractError) {
      if (options.json) {
        print(JSON.stringify({ error: { code: error.code, message: error.message } }));
      }
      process.stderr.write(`error: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`error: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
