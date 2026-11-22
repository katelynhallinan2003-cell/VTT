import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { loadImage } from '../core/images';
import { hideGrid, scaleCut, type GridCut, type PixelImage } from '../core/gridcut';
import { hideHexGrid } from '../core/hexcut';

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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const RETRY_DELAYS = [1200, 3000, 6000];

/** Freshly uploaded images can take a few seconds to appear on the image host, so try a few times. */
async function loadImageWithRetry(url: string): Promise<HTMLImageElement> {
  const remote = !url.startsWith('blob:') && !url.startsWith('data:');
  let last: unknown;
  for (let i = 0; i <= (remote ? RETRY_DELAYS.length : 0); i++) {
    try {
      // retries add a harmless query so a cached "not found" answer is not reused
      return await loadImage(i === 0 ? url : `${url}${url.includes('?') ? '&' : '?'}r=${i}`, true);
    } catch (e) {
      last = e;
      if (i < RETRY_DELAYS.length && remote) await sleep(RETRY_DELAYS[i]);
    }
  }
  throw last;
}

const cache = new Map<string, Promise<LoadedTexture | null>>();

type FailHandler = (kind: 'map' | 'token', url: string) => void;
let onFail: FailHandler | null = null;
/** Called whenever a texture could not be loaded (the board turns this into a visible message). */
export function setTextureFailHandler(fn: FailHandler | null) { onFail = fn; }

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
        const img = await loadImageWithRetry(url);
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
        onFail?.(kind, url);
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

/** The pixels of a loaded map, as the screen shows them (a very large map is already scaled down, see `scale`). */
export function readPixels(tex: LoadedTexture): { img: PixelImage; id: ImageData; ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement } | null {
  try {
    const src = tex.texture.source as unknown as { resource: CanvasImageSource; pixelWidth: number; pixelHeight: number };
    const w = src.pixelWidth, h = src.pixelHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src.resource, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    return { img: { data: id.data, width: w, height: h }, id, ctx, canvas };
  } catch (e) {
    console.warn('could not read the map pixels', e);
    return null;
  }
}

/** A copy of the map with its printed grid filled in. `cut` is in pixels of the original picture. */
export async function gridlessTexture(tex: LoadedTexture, cut: GridCut): Promise<Texture | null> {
  // let the screen paint ("working…") before the heavy part
  await new Promise<void>((r) => setTimeout(r, 20));
  const px = readPixels(tex);
  if (!px) return null;
  const c = scaleCut(cut, 1 / tex.scale);
  if (c.hex) hideHexGrid(px.img, c); else hideGrid(px.img, c);
  px.ctx.putImageData(px.id, 0, 0);
  return new Texture({ source: new CanvasSource({ resource: px.canvas, scaleMode: 'linear', autoGenerateMipmaps: true }) });
}
