import { CanvasSource, ImageSource, Texture } from 'pixi.js';
import { loadImage } from '../core/images';
import { hideGrid, scaleCut, WORK_SIDE, type GridCut, type PixelImage } from '../core/gridcut';
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
        if (cache.get(key) === p) cache.delete(key);
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

function readPixels(source: CanvasImageSource, width: number, height: number, maxSide = Infinity) {
  try {
    const sampleScale = Math.max(1, Math.ceil(Math.max(width, height) / maxSide));
    const w = Math.max(1, Math.floor(width / sampleScale));
    const h = Math.max(1, Math.floor(height / sampleScale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingQuality = 'high';
    // Use one scale on both axes. The canvas clips any partial pixel on the far edge.
    ctx.drawImage(source, 0, 0, width / sampleScale, height / sampleScale);
    const id = ctx.getImageData(0, 0, w, h);
    return { img: { data: id.data, width: w, height: h } satisfies PixelImage, id, ctx, canvas, sampleScale };
  } catch (e) {
    console.warn('could not read the map pixels', e);
    return null;
  }
}

/** A renderer may discard fine lines to fit its GPU. Sample the original at the finder's resolution. */
export async function readGridSample(tex: LoadedTexture, url: string, maxSide = 2 * WORK_SIDE) {
  const src = tex.texture.source;
  if (src.pixelWidth === tex.w && src.pixelHeight === tex.h) {
    return readPixels(src.resource, tex.w, tex.h, maxSide);
  }
  try {
    const original = await loadImageWithRetry(url);
    return readPixels(original, original.naturalWidth, original.naturalHeight, maxSide);
  } catch {
    return null;
  }
}

// Pictures are immutable upload URLs. Version the key when the pixel repair or display limits change.
export function gridlessKey(url: string, cut: GridCut): string {
  return JSON.stringify([url, maxTextureSide(), cut.p, cut.x, cut.y, cut.t, cut.hex ?? 'square']);
}

const pendingSaves = new Map<string, Promise<void>>();
async function pictureCache(key: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
  return { cache: await caches.open('vtt-gridless-v1'), path: new URL('./__gridless/' + hash, document.baseURI).href };
}

export async function savedGridlessTexture(key: string): Promise<LoadedTexture | null> {
  try {
    await pendingSaves.get(key);
    const { cache, path } = await pictureCache(key);
    const entry = await cache.match(path);
    if (!entry) return null;
    const w = Number(entry.headers.get('X-Map-Width')), h = Number(entry.headers.get('X-Map-Height'));
    if (!(w > 0 && h > 0)) return null;
    const bitmap = await createImageBitmap(await entry.blob());
    return { w, h, scale: w / bitmap.width, texture: new Texture({ source: new ImageSource({
      resource: bitmap, scaleMode: 'linear', autoGenerateMipmaps: true,
    }) }) };
  } catch { return null; } // Private browsing, eviction or an unreadable entry: rebuild from the original.
}

function saveGridless(key: string, canvas: HTMLCanvasElement, w: number, h: number) {
  if (pendingSaves.has(key)) return;
  const save = (async () => {
    const { cache, path } = await pictureCache(key);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (blob) await cache.put(path, new Response(blob, { headers: {
      'Content-Type': 'image/png', 'X-Map-Width': String(w), 'X-Map-Height': String(h),
    } }));
  })().catch(() => {}).finally(() => pendingSaves.delete(key));
  pendingSaves.set(key, save);
}

/** A copy of the map with its printed grid filled in. `cut` is in pixels of the original picture. */
export async function gridlessTexture(tex: LoadedTexture, cut: GridCut, key: string): Promise<LoadedTexture | null> {
  const src = tex.texture.source;
  const px = readPixels(src.resource, src.pixelWidth, src.pixelHeight);
  if (!px) return null;
  const c = scaleCut(cut, 1 / tex.scale);
  if (c.hex) hideHexGrid(px.img, c); else hideGrid(px.img, c);
  px.ctx.putImageData(px.id, 0, 0);
  saveGridless(key, px.canvas, tex.w, tex.h);
  return { ...tex, texture: new Texture({ source: new CanvasSource({ resource: px.canvas, scaleMode: 'linear', autoGenerateMipmaps: true }) }) };
}
