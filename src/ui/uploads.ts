import { prepareMapImage, prepareTokenImage } from '../core/images';
import { uploadToImgbb, type UploadResult } from '../core/imgbb';
import type { TableClient } from '../state/client';

const RECENT_KEY = 'vtt-recent-tokens-v1';

export interface RecentImage { url: string; name: string }
export function getRecent(): RecentImage[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
export function addRecent(item: RecentImage) {
  if (item.url.startsWith('blob:')) return;
  const list = [item, ...getRecent().filter((r) => r.url !== item.url)].slice(0, 24);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

/**
 * Prepare and upload an image. Maps keep full resolution; tokens are capped at 512px.
 * In local demo mode (no imgbb key) images become browser-local blob URLs.
 */
export async function uploadImage(client: TableClient, file: Blob, kind: 'map' | 'token', name?: string): Promise<UploadResult> {
  const prepared = kind === 'map' ? await prepareMapImage(file, name) : await prepareTokenImage(file, name);
  const key = client.uploadKey;
  if (!key) {
    if (client.backend.kind === 'mock') {
      const url = URL.createObjectURL(prepared.blob);
      return { url, thumb: url, w: prepared.w, h: prepared.h };
    }
    throw new Error(client.isDM
      ? 'Add your imgbb API key in Settings → Uploads before uploading images.'
      : 'The DM has not set up image uploads yet. You can paste an image link instead.');
  }
  const res = await uploadToImgbb(prepared.blob, key, prepared.name);
  const out = { ...res, w: res.w || prepared.w, h: res.h || prepared.h };
  if (kind === 'token') addRecent({ url: out.url, name: name ?? 'token' });
  return out;
}
