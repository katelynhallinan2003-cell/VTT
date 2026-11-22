import assert from 'node:assert/strict';
import { launch } from './lib.mjs';

// Pass the original gridless WebP in LARGE_MAP_FILE to check a published map locally.
const { browser, context } = await launch();
try {
  const dm = await context.newPage();
  const errors = [];
  dm.on('pageerror', (e) => errors.push(e.message));
  await dm.goto((process.env.BASE || 'http://127.0.0.1:4174/') + '?demo');
  await dm.getByRole('button', { name: /Start as the DM/ }).click();
  await dm.getByPlaceholder('New table name').fill('Large map');
  await dm.getByRole('button', { name: 'Create table' }).click();
  await dm.getByRole('button', { name: '+ New scene' }).first().click();
  await dm.getByRole('button', { name: 'Create scene' }).click();
  await dm.waitForFunction(() => window.__vtt?.client.scene?.meta && !window.__vtt.board.fitPending);

  // Leave the camera outside the new map at the zoom shown in the bug report.
  await dm.evaluate(() => {
    const b = window.__vtt.board;
    b.zoomBy(1.64 / b.zoomNow);
    b.centerOn({ x: -2000, y: -2000 });
  });
  const map = process.env.LARGE_MAP_FILE || {
    name: 'Room_NoGrid.webp', mimeType: 'image/webp',
    buffer: Buffer.from(await dm.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 3840;
      c.height = 4800;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#493556';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#796858';
      ctx.fillRect(500, 500, 2800, 3600);
      return c.toDataURL('image/webp').split(',')[1];
    }), 'base64'),
  };
  await dm.locator('.sect input[type=file]').first().setInputFiles(map);
  await dm.waitForFunction(() => window.__vtt.board.mapSprite && window.__vtt.client.scene.meta.gridTried);
  await dm.waitForFunction(() => {
    const { board, client } = window.__vtt;
    const { mapW, mapH } = client.scene.meta;
    const tl = board.worldToScreen({ x: 0, y: 0 });
    const br = board.worldToScreen({ x: mapW, y: mapH });
    return tl.x >= 0 && tl.y >= 0 && br.x <= innerWidth && br.y <= innerHeight;
  }, null, { timeout: 5000 });
  await dm.getByText('No clear printed grid found.', { exact: true }).waitFor();
  const result = await dm.evaluate(() => {
    const { board, client } = window.__vtt;
    const gl = board.app.renderer.gl;
    board.app.render();
    const rgba = new Uint8Array(4);
    gl.readPixels(Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return { rgba: [...rgba], lost: gl.isContextLost(), cut: client.scene.meta.mapGrid };
  });
  assert.equal(result.lost, false);
  assert.equal(result.rgba[3], 255);
  assert.ok(Math.max(...result.rgba.slice(0, 3)) < 245, 'the map is visible on the white board');
  assert.equal(result.cut, null);
  console.log('PASS  Large gridless map fits the board, renders, and finishes printed-grid detection');

  // Creating and following the active scene can open the same scene twice while its picture is decoding.
  const zoom = await dm.evaluate(() => {
    const { board, client } = window.__vtt;
    board.zoomBy(2);
    const createBitmap = window.createImageBitmap.bind(window);
    window.createImageBitmap = async (...args) => {
      window.createImageBitmap = createBitmap;
      await new Promise((resolve) => { window.finishFirstDecode = resolve; });
      return createBitmap(...args);
    };
    const load = board.loadMap.bind(board);
    board.loadMap = (...args) => {
      board.loadMap = load;
      window.firstMapLoad = load(...args);
      return window.firstMapLoad;
    };
    client.openScene(client.viewSceneId);
    return board.zoomNow;
  });
  await dm.waitForFunction(() => typeof window.finishFirstDecode === 'function');
  await dm.evaluate(() => window.__vtt.client.openScene(window.__vtt.client.viewSceneId));
  await dm.waitForFunction(() => window.__vtt.board.mapSprite);
  await dm.evaluate(async () => { window.finishFirstDecode(); await window.firstMapLoad; });
  const reopened = await dm.evaluate(() => {
    const b = window.__vtt.board;
    return { sprites: b.mapLayer.children.length, live: !!b.mapSprite.texture.source, zoom: b.zoomNow };
  });
  assert.deepEqual(reopened, { sprites: 1, live: true, zoom });
  assert.deepEqual(errors, []);
  console.log('PASS  Reopening the same scene during decode keeps its live texture and saved camera');
} finally {
  await browser.close();
}
