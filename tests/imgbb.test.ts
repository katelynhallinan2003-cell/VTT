import { afterEach, expect, it, vi } from 'vitest';
import { imgbbDeleteUrl, uploadToImgbb } from '../src/core/imgbb';

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
