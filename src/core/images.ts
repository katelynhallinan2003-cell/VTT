/** Image helpers: decoding, downscaling and preparing files for upload. */

export const MAX_UPLOAD_BYTES = 31 * 1024 * 1024; // imgbb's free limit is 32 MB

export function loadImage(src: string | Blob, crossOrigin = true): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    if (crossOrigin && typeof src === 'string' && !src.startsWith('blob:') && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); reject(new Error('Could not load image')); };
    img.src = url;
  });
}

/** Work out (in plain words) why an image URL could not be used on the board. */
export async function diagnoseImage(url: string): Promise<string> {
  try {
    const r = await fetch(url, { mode: 'cors', cache: 'no-store' });
    if (!r.ok) return `the image host answered with an error (HTTP ${r.status}); the file may have been deleted`;
    return 'the image downloaded but the browser could not decode it';
  } catch {
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
      return 'the image host does not allow other websites to use its images (CORS)';
    } catch {
      return 'the browser could not reach the image host (offline, or an ad/privacy blocker?)';
    }
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality));
}

export function drawScaled(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export interface PreparedImage { blob: Blob; w: number; h: number; name: string }

const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

/** Maps keep their full resolution; only files over the host's size limit are re-encoded. */
export async function prepareMapImage(file: File | Blob, name = (file as File).name || 'map'): Promise<PreparedImage> {
  const img = await loadImage(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (file.size <= MAX_UPLOAD_BYTES && OK_TYPES.includes(file.type)) return { blob: file, w, h, name };
  // Too big (or an unusual format): re-encode as JPEG, shrinking only if quality alone isn't enough.
  let scale = 1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const c = drawScaled(img, w * scale, h * scale);
    for (const q of [0.92, 0.85, 0.75]) {
      const blob = await canvasToBlob(c, 'image/jpeg', q);
      if (blob.size <= MAX_UPLOAD_BYTES) return { blob, w: c.width, h: c.height, name: name.replace(/\.\w+$/, '') + '.jpg' };
    }
    scale *= 0.85;
  }
  throw new Error('Image is too large to upload even after compression');
}

/** Tokens are small: cap at 512px and keep transparency (PNG). */
export async function prepareTokenImage(file: File | Blob, name = (file as File).name || 'token', maxSide = 512): Promise<PreparedImage> {
  const img = await loadImage(file);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = drawScaled(img, img.naturalWidth * k, img.naturalHeight * k);
  const blob = await canvasToBlob(c, 'image/png');
  return { blob, w: c.width, h: c.height, name: name.replace(/\.\w+$/, '') + '.png' };
}
