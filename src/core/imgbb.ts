import { loadImage } from './images';

export interface UploadResult { url: string; thumb: string; w: number; h: number }

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
    const msg = json?.error?.message || `imgbb returned ${res.status}`;
    throw new Error(`Upload failed: ${msg}`);
  }
  const d = json.data;
  return {
    url: d.image?.url || d.url,
    thumb: d.thumb?.url || d.medium?.url || d.image?.url || d.url,
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
