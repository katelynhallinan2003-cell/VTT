import assert from 'node:assert/strict';
import { launch } from './lib.mjs';

const { browser, context } = await launch();
try {
  const dm = await context.newPage();
  const errors = [];
  dm.on('pageerror', (e) => errors.push(e.message));
  await dm.goto((process.env.BASE || 'http://127.0.0.1:4174/') + '?demo');
  await dm.getByRole('button', { name: /Start as the DM/ }).click();
  await dm.getByPlaceholder('New table name').fill('Map scale');
  await dm.getByRole('button', { name: 'Create table' }).click();
  await dm.getByRole('button', { name: '+ New scene' }).first().click();
  const map = process.env.SCALE_MAP_FILE || {
    name: 'Winter.png', mimeType: 'image/png',
    buffer: Buffer.from(await dm.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = c.height = 900;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#d3e1ef';
      ctx.fillRect(0, 0, 900, 900);
      return c.toDataURL().split(',')[1];
    }), 'base64'),
  };
  await dm.locator('.modal input[type=file]').setInputFiles(map);
  await dm.getByRole('button', { name: 'Create scene' }).click();
  const picker = dm.locator('.flyout[aria-label="Map scale"]');
  await picker.waitFor();
  const grid = () => dm.evaluate(() => window.__vtt.client.grid);
  const initial = await grid();
  assert.equal(initial.visible, false);
  assert.equal(initial.snap, false);
  assert.equal(initial.rule, 'euclid');
  await dm.mouse.click(520, 400);
  await dm.mouse.click(520, 400);
  await picker.getByText(/Click the second point/).waitFor();
  await picker.getByRole('button', { name: 'Cancel' }).click();
  assert.deepEqual(await grid(), initial);
  await dm.getByRole('button', { name: 'Set scale with two points' }).click();
  const zoom = await dm.evaluate(() => window.__vtt.board.zoomNow);
  await dm.mouse.click(520, 400);
  await dm.mouse.click(580, 480);
  await picker.getByRole('button', { name: 'Gridless' }).click();
  await picker.waitFor({ state: 'hidden' });
  const calibrated = await grid();
  assert.ok(Math.abs(calibrated.cell * zoom - 100 * initial.ft / 10) < 0.01);
  await dm.getByRole('button', { name: /Ruler/ }).first().click();
  await dm.mouse.move(520, 400);
  await dm.mouse.down();
  await dm.mouse.move(580, 480);
  await dm.waitForFunction(() => window.__vtt.board.plotLabels.some((label) => label.visible && label.text === '10 ft'));
  await dm.mouse.up();
  await dm.keyboard.press('Escape');
  const panel = dm.getByRole('group', { name: 'Grid type' });
  for (const [name, shape] of [['Hex, rows', 'pointy'], ['Hex, columns', 'flat'], ['Squares', 'square'], ['Gridless', 'square']]) {
    const btn = panel.getByRole('button', { name, exact: true });
    await btn.click();
    await dm.waitForFunction(([shape, visible]) => {
      const g = window.__vtt.client.grid;
      return g.shape === shape && g.visible === visible && g.snap === visible;
    }, [shape, name !== 'Gridless']);
    assert.equal((await grid()).cell, calibrated.cell);
  }
  await dm.getByRole('button', { name: 'Set scale with two points' }).click();
  await dm.mouse.click(520, 400);
  await dm.mouse.click(720, 400);
  await picker.getByRole('button', { name: 'Hex, rows' }).click();
  await picker.waitFor({ state: 'hidden' });
  const hex = await grid();
  assert.equal(hex.shape, 'pointy');
  assert.equal(hex.visible, true);
  assert.ok(Math.abs(hex.cell - 2 * calibrated.cell) < 0.01);
  assert.deepEqual(errors, []);
  console.log('PASS  Gridless import, cancel, two unsnapped clicks, ten-foot diagonal ruler and all four overlays');
} finally { await browser.close(); }
