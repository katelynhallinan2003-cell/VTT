import { afterEach, expect, it, vi } from 'vitest';
import { uploadToImgbb } from '../src/core/imgbb';

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
