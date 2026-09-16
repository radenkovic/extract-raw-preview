/**
 * Decode HEVC/AV1 image items and JPEG-encode the pixels.
 *
 * Used when a HEIC/HEIF/AVIF file has no stored JPEG or PNG preview.
 * HEVC goes through libheif-js (WASM); AV1 through sharp's bundled decoder.
 */

import { createRequire } from "node:module";
import type { HeifDecoder as HeifDecoderCtor, HeifImage } from "libheif-js";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const { HeifDecoder } = require("libheif-js") as { HeifDecoder: typeof HeifDecoderCtor };

/** Quality for the fallback JPEG. Pinned so fixture byte lengths stay stable. */
export const REENCODE_JPEG_QUALITY = 90;

export interface ReencodedJpeg {
  data: Uint8Array;
  width: number;
  height: number;
}

function toJpegBuffer(jpeg: Buffer, width: number, height: number): ReencodedJpeg {
  return { data: new Uint8Array(jpeg), width, height };
}

function displayHeif(image: HeifImage): Promise<Uint8ClampedArray> {
  const width = image.get_width();
  const height = image.get_height();
  return new Promise((resolve, reject) => {
    const data = new Uint8ClampedArray(width * height * 4);
    image.display({ data, width, height }, (result) => {
      if (!result) {
        reject(new Error("HEIF display failed"));
        return;
      }
      resolve(result.data);
    });
  });
}

async function rgbaToJpeg(rgba: Uint8Array, width: number, height: number): Promise<ReencodedJpeg> {
  const jpeg = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .jpeg({ quality: REENCODE_JPEG_QUALITY })
    .toBuffer();
  return toJpegBuffer(jpeg, width, height);
}

/**
 * Decodes HEVC-coded HEIC/HEIF via libheif-js and JPEG-encodes the smallest
 * image (the thumbnail when one is present).
 */
export async function decodeHeifToJpeg(bytes: Uint8Array): Promise<ReencodedJpeg | undefined> {
  try {
    const decoder = new HeifDecoder();
    const images = decoder.decode(bytes);
    if (images.length === 0) return undefined;
    let chosen = images[0] as HeifImage;
    for (const image of images) {
      if (image.get_width() * image.get_height() < chosen.get_width() * chosen.get_height()) {
        chosen = image;
      }
    }
    const width = chosen.get_width();
    const height = chosen.get_height();
    if (width <= 0 || height <= 0) return undefined;
    return rgbaToJpeg(new Uint8Array(await displayHeif(chosen)), width, height);
  } catch {
    return undefined;
  }
}

/** Decodes AVIF via sharp and JPEG-encodes the primary image. */
export async function decodeAvifToJpeg(bytes: Uint8Array): Promise<ReencodedJpeg | undefined> {
  try {
    const image = sharp(bytes);
    const meta = await image.metadata();
    if (!meta.width || !meta.height) return undefined;
    const jpeg = await image.jpeg({ quality: REENCODE_JPEG_QUALITY }).toBuffer();
    return toJpegBuffer(jpeg, meta.width, meta.height);
  } catch {
    return undefined;
  }
}
