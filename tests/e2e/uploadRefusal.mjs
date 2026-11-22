import assert from 'node:assert/strict';
import { launch } from './lib.mjs';

const { browser, context } = await launch();
try {
  const dm = await context.newPage();
  const base = process.env.BASE || 'http://127.0.0.1:4174/';
  let attempts = 0;
  await dm.route('https://api.imgbb.com/**', (route) => {
    attempts++;
    return route.fulfill({ status: 403, json: { success: false, error: { message: 'You have been forbidden to use this website.' } } });
  });
  await dm.goto(base + '?demo');
  await dm.getByRole('button', { name: /Start as the DM/ }).click();
  await dm.getByPlaceholder('New table name').fill('Upload refusal');
  await dm.getByRole('button', { name: 'Create table' }).click();
  await dm.getByRole('button', { name: '+ New scene' }).first().click();
  await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
  await dm.locator('.dropzone-name').waitFor();
  await dm.getByRole('button', { name: 'Create scene' }).click();
  await dm.waitForFunction(() => window.__vtt?.board.mapSprite);
  const original = await dm.evaluate(async () => {
    const c = window.__vtt.client;
    await c.setUploadKey('test-key');
    return c.scene.meta.mapUrl;
  });
  await dm.waitForFunction(() => window.__vtt.client.uploadKey === 'test-key');
  const picture = Buffer.from(await dm.evaluate(() => {
    const canvas = document.createElement('canvas');
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
  await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: picture });
  await dm.getByText(/ImgBB refused this upload \(HTTP 403\)/).waitFor();
  assert.equal(await dm.evaluate(() => window.__vtt.client.scene.meta.mapUrl), original);
  console.log('PASS  ImgBB rejection identifies the host and preserves the existing map');

  const url = new URL('linked-map.png', base).href;
  await dm.route(url, (route) => route.fulfill({ contentType: 'image/png', body: picture }));
  await dm.getByRole('button', { name: 'Library', exact: true }).click();
  await dm.getByPlaceholder('…or paste a link to a picture').fill(url);
  await dm.getByRole('button', { name: 'Add', exact: true }).click();
  await dm.getByRole('button', { name: 'Use in scene' }).click();
  await dm.waitForFunction((url) => window.__vtt.board.mapUrl === url && window.__vtt.board.mapSprite, url);
  assert.equal(attempts, 1);
  console.log('PASS  A direct picture link replaces the map without another upload');
} finally {
  await browser.close();
}
