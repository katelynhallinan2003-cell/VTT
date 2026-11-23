import assert from 'node:assert/strict';
import { launch } from './lib.mjs';

const { browser, context } = await launch();
try {
  const dm = await context.newPage();
  const errors = [];
  dm.on('pageerror', e => errors.push(e.message));
  const base = process.env.BASE || 'http://127.0.0.1:4174/';
  const imageUrl = 'https://i.ibb.co/example/winter.png';
  const deleteUrl = 'https://ibb.co/example/testDeleteToken';
  await context.route(deleteUrl, route => route.fulfill({ contentType: 'text/html', body: '<title>Test host confirmation</title>' }));
  await dm.route('https://api.imgbb.com/**', route => route.fulfill({ json: {
    success: true, data: { url: imageUrl, delete_url: deleteUrl, width: 2, height: 2 },
  } }));
  await dm.goto(base + '?demo');
  await dm.getByRole('button', { name: /Start as the DM/ }).click();
  await dm.getByPlaceholder('New table name').fill('Library deletion');
  await dm.getByRole('button', { name: 'Create table' }).click();
  await dm.waitForFunction(() => window.__vtt?.client.isDM);
  const png = Buffer.from(await dm.evaluate(async () => {
    const c = window.__vtt.client;
    // Exercise the hosted-upload branch while every database operation stays in the demo backend.
    c.backend.kind = 'firebase';
    await c.setUploadKey('test-key');
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 2;
    return canvas.toDataURL().split(',')[1];
  }), 'base64');
  await dm.route(imageUrl, route => route.fulfill({ contentType: 'image/png', body: png }));
  const button = (name) => dm.getByRole('button', { name, exact: true });
  await button('Library').click();
  await dm.locator('.modal input[type=file]').setInputFiles({ name: 'Winter.png', mimeType: 'image/png', buffer: png });
  await button('Delete Winter').waitFor();
  const exported = await dm.evaluate(() => window.__vtt.client.exportCampaign({ library: true }));
  assert.equal(exported.library.maps[0].url, imageUrl);
  assert.ok(!JSON.stringify(exported).includes('testDeleteToken'));
  await button('Close').click();
  await button('+ New scene').first().click();
  const scene = dm.getByRole('dialog', { name: 'New scene' });
  await scene.getByRole('button', { name: 'Winter', exact: true }).click();
  await button('Delete Winter').click();
  await scene.locator('.thumb').waitFor({ state: 'detached' });
  assert.equal(context.pages().length, 1);
  await button('Create scene').click();
  await dm.waitForFunction(() => window.__vtt.client.scene?.meta && !window.__vtt.client.scene.meta.mapUrl);
  await dm.evaluate(async url => {
    const c = window.__vtt.client;
    await c.backend.set('users/' + c.uid + '/library/tokens/old', { name: 'Old token', url, addedAt: 1 });
  }, imageUrl);
  await button('Library').click();
  await dm.getByText('ImgBB cleanup (1)', { exact: true }).click();
  const link = dm.getByRole('link', { name: /Winter/ });
  assert.equal(await link.getAttribute('href'), deleteUrl);
  const after = await dm.evaluate(() => window.__vtt.client.exportCampaign({ library: true }));
  assert.ok(!JSON.stringify(after).includes('testDeleteToken'));
  const [host] = await Promise.all([context.waitForEvent('page'), link.click()]);
  await host.waitForLoadState();
  assert.equal(host.url(), deleteUrl);
  await host.close();
  await button('Dismiss link for Winter').click();
  await link.waitFor({ state: 'detached' });
  await button('Token art').click();
  await button('Delete Old token').click();
  await dm.getByRole('dialog', { name: 'My library' }).waitFor();
  await button('Delete Old token').waitFor({ state: 'detached' });
  assert.equal(await dm.getByText(/ImgBB cleanup/).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS  One-click removal, selected map clearing, optional private cleanup, export privacy and older token art');
} finally { await browser.close(); }
