declare module "libheif-js" {
  export interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      imageData: { data: Uint8ClampedArray; width: number; height: number },
      callback: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void,
    ): void;
  }

  export class HeifDecoder {
    decode(data: Uint8Array): HeifImage[];
  }
}
