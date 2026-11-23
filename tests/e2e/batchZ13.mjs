// Paint height from colour: the cells that are a picked colour on the map picture are painted as one area of a chosen height.
import { launch, watch, sleep } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const BASE = (process.env.BASE || 'http://127.0.0.1:4174/') + '?demo';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
mkdirSync('/tmp/shots', { recursive: true });
const { browser, context } = await launch();
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.evaluate(() => localStorage.clear());
await dm.reload();
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('Z13');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(600);



// stony floor with two blue pools, aligned to a 100 px grid
const b64 = await dm.evaluate(async () => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#c9c4b8'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#2a5cc8';
  x.fillRect(200, 200, 300, 200);   // 3 x 2 squares
  x.fillRect(900, 500, 200, 300);   // 2 x 3 squares
  return c.toDataURL('image/png').split(',')[1];
});
await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'pools.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && !window.__vtt.client.scene.meta.mapUrl.includes('sample'); }, null, { timeout: 20000 });
await sleep(800);
await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return window.__vtt.client.updateScene({ mapX: 0, mapY: 0, mapScale: 1, grid: { ...m.grid, shape: 'square', cell: 100, ox: 0, oy: 0, snap: true } }); });
await sleep(500);
const areas = () => dm.evaluate(() => { const c = window.__vtt.client; return [...c.scene.draws.values()].filter((d) => d.k === 'terrain'); });

await dm.keyboard.press('h');
await dm.getByRole('button', { name: /Paint height from a colour/ }).click();
await dm.getByRole('dialog', { name: 'Paint height from colour' }).waitFor();
await dm.waitForFunction(() => document.querySelector('.dw-canvas')?.width === 700);
check('nothing is painted before a colour is picked', /Click the colour/.test(await dm.locator('.modal-foot').innerText()));
const box = await dm.locator('.dw-canvas').boundingBox();
await dm.mouse.click(box.x + box.width * (350 / 1400), box.y + box.height * (300 / 1000));
await dm.waitForFunction(() => /\d+ squares would be painted/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 10000 });
const foot = await dm.locator('.modal-foot').innerText();
check('every square of both pools is found (6 and 6)', /12 squares would be painted/.test(foot), foot.replace(/\n/g, ' '));
await dm.screenshot({ path: '/tmp/shots/z13-height.png' });
await dm.locator('.modal .numf input').fill('-10');
await dm.getByLabel('Only the patch I clicked').check();
await dm.waitForFunction(() => /(^|[^0-9])6 squares would be painted/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 10000 });
check('"only the patch I clicked" keeps just the first pool (6 squares)', true);
await dm.getByLabel('Only the patch I clicked').uncheck();
await dm.waitForFunction(() => /12 squares would be painted/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 10000 });
await dm.getByRole('button', { name: /^Paint 12 squares$/ }).click();
await sleep(700);
const t = await areas();
check('one area of terrain strokes was painted', t.length >= 1 && new Set(t.map((d) => d.hg)).size === 1 && t.every((d) => d.hz === -10 && d.hc === true));
const g = await dm.evaluate(() => { const b = window.__vtt.board; const t = { fly: false, size: 1, x: 0, y: 0 }; const z = (x, y) => b.heightOf(t, { x, y }).ground; return [z(350, 300), z(1000, 650), z(700, 700)]; });
check('the pools are 10 ft down and the floor is level', g[0] === -10 && g[1] === -10 && g[2] === 0, JSON.stringify(g));
await dm.keyboard.press('Control+z');
await sleep(500);
check('one Ctrl+Z takes it back', (await areas()).length === 0);

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
