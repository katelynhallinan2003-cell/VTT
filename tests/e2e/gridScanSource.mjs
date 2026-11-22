import assert from 'node:assert/strict';
import { launch } from './lib.mjs';

// A 36-pixel square on this map shrinks below the finder's minimum automatic
// spacing on the display texture. The scene still uses original-image pixels.
const { browser, context } = await launch();
try {
  await context.addInitScript(() => {
    for (const gl of [WebGLRenderingContext, WebGL2RenderingContext]) {
      const get = gl.prototype.getParameter;
      gl.prototype.getParameter = function (key) {
        const value = get.call(this, key);
        return key === this.MAX_TEXTURE_SIZE ? Math.min(1024, value) : value;
      };
    }
  });
  const page = await context.newPage();
  await page.goto((process.env.BASE || 'http://127.0.0.1:4174/') + '?demo');
  await page.getByRole('button', { name: /Start as the DM/ }).click();
  await page.getByPlaceholder('New table name').fill('Source picture grid');
  await page.getByRole('button', { name: 'Create table' }).click();
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2100;
    canvas.height = 2600;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#596649';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#95a18e';
    for (let x = 8; x < canvas.width; x += 36) ctx.fillRect(x, 0, 1, canvas.height);
    for (let y = 12; y < canvas.height; y += 36) ctx.fillRect(0, y, canvas.width, 1);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: '+ New scene' }).first().click();
  await page.locator('.modal input[type=file]').setInputFiles({ name: 'Printed.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await page.getByRole('button', { name: 'Create scene' }).click();
  await page.waitForFunction(() => window.__vtt.client.scene?.meta?.mapGrid || window.__vtt.ui.data.tool === 'scale');
  const state = await page.evaluate(() => {
    const { board, client, ui } = window.__vtt;
    return { downscaled: board.mapTex.scale > 2, grid: client.grid, cut: client.scene.meta.mapGrid, tool: ui.data.tool };
  });
  assert.ok(state.downscaled);
  assert.ok(state.cut && !state.cut.hex && Math.abs(state.cut.p - 36) < 0.1);
  assert.equal(state.grid.visible, true);
  assert.notEqual(state.tool, 'scale');
  console.log('PASS  A small display texture still finds and aligns the original printed squares');

  // Simulate the saved settings of a scene that previously missed the grid.
  await page.evaluate(async () => {
    const { client, ui } = window.__vtt;
    await client.updateScene({ mapGrid: null, grid: { visible: false, snap: false }, gridTried: true });
    ui.set({ tool: 'scale' });
  });
  await page.getByRole('button', { name: /Grid printed on the map/i }).click();
  await page.getByRole('button', { name: 'Find and hide it' }).click();
  await page.waitForFunction(() => {
    const { client, ui } = window.__vtt;
    return Math.abs(client.scene.meta.mapGrid?.p - 36) < 0.1 && client.grid.snap && client.grid.visible && ui.data.tool !== 'scale';
  });
  console.log('PASS  A previously missed map recovers without recreating the scene or setting the scale');
} finally {
  await browser.close();
}
