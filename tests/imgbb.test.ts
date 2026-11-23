import { afterEach, expect, it, vi } from 'vitest';
import { deleteFromImgbb, imgbbDeleteUrl, uploadToImgbb } from '../src/core/imgbb';
import { MockBackend } from '../src/backend/mock';
import { removeLibraryItem } from '../src/state/account';
import { P } from '../src/state/paths';
import type { LibraryItem } from '../src/types';

const file = new Blob(['picture'], { type: 'image/webp' });
afterEach(() => vi.unstubAllGlobals());

it.each([
  [403, '<html>Forbidden</html>'],
  [400, JSON.stringify({ success: false, error: { message: 'You have been forbidden to use this website.' } })],
] as const)('identifies an ImgBB refusal returned with HTTP %s', async (status, body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));
  await expect(uploadToImgbb(file, 'test-key')).rejects.toThrow(`ImgBB refused this upload (HTTP ${status})`);
});

it('requires a usable picture address before an upload can replace a map', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true, data: {} })));
  await expect(uploadToImgbb(file, 'test-key')).rejects.toThrow('ImgBB did not return a picture link');
});

it('retains the private deletion page returned by ImgBB', async () => {
  const deleteUrl = 'https://ibb.co/abc123/testToken';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({
    success: true, data: { url: 'https://i.ibb.co/x/map.jpg', delete_url: deleteUrl },
  })));
  await expect(uploadToImgbb(file, 'test-key')).resolves.toMatchObject({ deleteUrl });
});

it.each([undefined, 'https://ibb.co/map', 'https://ibb.co.example.com/map/token',
  'https://ibb.co@other.example/map/token', 'javascript:alert(1)'])('ignores non-management links', (url) => {
  expect(imgbbDeleteUrl(url)).toBeUndefined();
});

const DELETE_URL = 'https://ibb.co/abc123/testToken';

it('counts a hosted picture as deleted only when ImgBB answers that it succeeded', async () => {
  const f = vi.fn().mockResolvedValue(Response.json({ success: true, status: 200 }));
  vi.stubGlobal('fetch', f);
  await expect(deleteFromImgbb(DELETE_URL, 'k')).resolves.toBe(true);
  expect(f).toHaveBeenCalledWith(`${DELETE_URL}?key=k`, { method: 'DELETE' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>page</html>', { status: 200 })));
  await expect(deleteFromImgbb(DELETE_URL, 'k')).resolves.toBe(false);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false }, { status: 400 })));
  await expect(deleteFromImgbb(DELETE_URL, 'k')).resolves.toBe(false);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('blocked by CORS')));
  await expect(deleteFromImgbb(DELETE_URL, 'k')).resolves.toBe(false);
  await expect(deleteFromImgbb('https://evil.example/x', 'k')).resolves.toBe(false);
  await expect(deleteFromImgbb(DELETE_URL, '')).resolves.toBe(false);
});

async function libraryWith(item: LibraryItem) {
  const b = new MockBackend({ persist: false });
  await b.set(`${P.userLibrary('dm', 'maps')}/${item.id}`, { name: item.name, url: item.url, deleteUrl: item.deleteUrl, addedAt: 1 });
  return b;
}
const pic: LibraryItem = { id: 'p1', name: 'Cave', url: 'https://i.ibb.co/x/cave.jpg', deleteUrl: DELETE_URL, addedAt: 1 };

it('removing a library picture keeps its deletion link until ImgBB has really deleted it', async () => {
  const b = await libraryWith(pic);
  expect(await removeLibraryItem(b, 'dm', 'maps', pic, async () => false)).toBe(false);
  expect(await b.get(`${P.userLibrary('dm', 'maps')}/p1`)).toBeNull();
  expect(await b.get(`${P.imageCleanup('dm', 'maps')}/p1`)).toMatchObject({ deleteUrl: DELETE_URL });
});

it('removing a library picture drops the cleanup link once ImgBB has deleted it', async () => {
  const b = await libraryWith(pic);
  expect(await removeLibraryItem(b, 'dm', 'maps', pic, async () => true)).toBe(true);
  expect(await b.get(`${P.userLibrary('dm', 'maps')}/p1`)).toBeNull();
  expect(await b.get(`${P.imageCleanup('dm', 'maps')}/p1`)).toBeNull();
});
