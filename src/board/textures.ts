import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { loadImage } from '../core/images';

let gpuMax = 0;
export function maxTextureSide(): number {
  if (!gpuMax) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      gpuMax = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
    } catch { gpuMax = 4096; }
  }
  return gpuMax;
}

export interface LoadedTexture {
  texture: Texture;
  /** natural (original) image size */
  w: number;
  h: number;
  /** world pixels per texture pixel (>1 when the image was downscaled to fit the GPU) */
  scale: number;
}

const cache = new Map<string, Promise<LoadedTexture | null>>();

/** Cap on texture side / pixel count so huge maps stay crisp without exhausting GPU memory. */
function fitSize(w: number, h: number, maxSide: number, maxPixels: number) {
  let k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)));
  if (!Number.isFinite(k) || k <= 0) k = 1;
  return { w: Math.max(1, Math.floor(w * k)), h: Math.max(1, Math.floor(h * k)), k };
}

export function loadTexture(url: string, kind: 'map' | 'token'): Promise<LoadedTexture | null> {
  const key = `${kind}:${url}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const img = await loadImage(url, true);
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const limit = kind === 'map'
          ? fitSize(nw, nh, Math.min(maxTextureSide(), 8192), 40_000_000)
          : fitSize(nw, nh, Math.min(maxTextureSide(), 1024), 1_000_000);
        const bitmap = limit.k < 1
          ? await createImageBitmap(img, { resizeWidth: limit.w, resizeHeight: limit.h, resizeQuality: 'high' })
          : await createImageBitmap(img);
        const source = new ImageSource({
          resource: bitmap,
          autoGenerateMipmaps: true,
          scaleMode: 'linear',
        });
        return { texture: new Texture({ source }), w: nw, h: nh, scale: nw / bitmap.width };
      } catch (e) {
        console.warn('texture load failed', url, e);
        cache.delete(key);
        return null;
      }
    })();
    cache.set(key, p);
  }
  return p;
}

export function releaseTexture(url: string, kind: 'map' | 'token') {
  const key = `${kind}:${url}`;
  const p = cache.get(key);
  if (!p) return;
  cache.delete(key);
  void p.then((t) => t?.texture.destroy(true));
}

export function canvasTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: 'linear' }) });
}
