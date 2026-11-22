import { loadImage } from './images';

export interface UploadResult { url: string; thumb: string; w: number; h: number; deleteUrl?: string }

/** ImgBB returns a private management page with an image ID and a deletion token. */
export function imgbbDeleteUrl(value: unknown): string | undefined {
  return typeof value === 'string' && /^https:\/\/ibb\.co\/[A-Za-z0-9]+\/[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

/** Upload to imgbb (https://api.imgbb.com/). `key` is the DM's API key, shared with the table. */
export async function uploadToImgbb(blob: Blob, key: string, name?: string): Promise<UploadResult> {
  const fd = new FormData();
  fd.append('image', blob, name || 'image');
  if (name) fd.append('name', name.replace(/\.\w+$/, ''));
  let res: Response;
  try {
    res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(key)}`, { method: 'POST', body: fd });
  } catch {
    throw new Error('Could not reach imgbb. Check your connection (or an ad blocker) and try again.');
  }
  let json: any = null;
  try { json = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !json?.success) {
    const detail = typeof json?.error?.message === 'string' ? json.error.message.trim() : '';
    if (res.status === 403 || /\bforbidden\b/i.test(detail)) {
      throw new Error(`ImgBB refused this upload (HTTP ${res.status}). The DM can check uploads in Settings → Pictures and files → Test upload, or use a direct picture link.`);
    }
    throw new Error(`ImgBB upload failed (HTTP ${res.status}). ${detail}`.trim());
  }
  const d = json.data;
  const url = d?.image?.url || d?.url;
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('ImgBB did not return a picture link. Try the upload again.');
  }
  return {
    url,
    thumb: d.thumb?.url || d.medium?.url || url,
    deleteUrl: imgbbDeleteUrl(d.delete_url),
    w: Number(d.width) || 0,
    h: Number(d.height) || 0,
  };
}

/** Diagnostics for the settings screen: upload a 2x2 PNG, then make sure the browser can use it as a WebGL texture. */
export async function testImgbb(key: string): Promise<string[]> {
  const log: string[] = [];
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#4da3ff';
  ctx.fillRect(0, 0, 2, 2);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  try {
    const up = await uploadToImgbb(blob, key, 'vtt-test.png');
    log.push('Upload OK: ' + up.url);
    try {
      const img = await loadImage(up.url, true);
      const probe = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
      if (probe) {
        const tex = probe.createTexture();
        probe.bindTexture(probe.TEXTURE_2D, tex);
        probe.texImage2D(probe.TEXTURE_2D, 0, probe.RGBA, probe.RGBA, probe.UNSIGNED_BYTE, img);
        log.push('Browser can load it as a WebGL texture: OK (CORS is fine)');
      } else {
        log.push('WebGL is not available in this browser.');
      }
    } catch (e) {
      log.push('Loaded the image but the browser refused it for WebGL (CORS): ' + (e as Error).message);
    }
  } catch (e) {
    log.push((e as Error).message);
  }
  return log;
}
