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
  x.fillStyle = '#2e9a4f';
  x.fillRect(1200, 100, 100, 100);  // one green square
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
// the window can move a little as its controls change, so measure the picture again at every click
const clickPicture = async (px, py) => { const bx = await dm.locator('.dw-canvas').boundingBox(); await dm.mouse.click(bx.x + bx.width * (px / 1400), bx.y + bx.height * (py / 1000)); };
const footIs = (re) => dm.waitForFunction((src) => new RegExp(src).test(document.querySelector('.modal-foot')?.textContent || ''), re.source, { timeout: 10000 });
await footIs(/(^|[^0-9])6 squares would be painted/);
check('"only the patch I clicked" is on from the start, so just the first pool is found (6 squares)', await dm.getByLabel('Only the patch I clicked').isChecked());
await dm.screenshot({ path: '/tmp/shots/z13-height.png' });
await dm.locator('.modal .numf input').fill('-10');
await dm.getByLabel('Only the patch I clicked').uncheck();
await footIs(/12 squares would be painted/);
check('turning it off finds every blue square on the map (6 and 6)', true);
await dm.getByLabel('Only the patch I clicked').check();
await footIs(/(^|[^0-9])6 squares would be painted/);

// the + button: a second colour at the same height
const plus = dm.getByRole('button', { name: 'Add another colour' });
check('there is a + for another colour', await plus.isVisible() && !(await plus.isDisabled()));
await plus.click();
check('and it waits for a click on the picture before another can be added', await plus.isDisabled() && (await dm.locator('.dw-swatch.empty').count()) === 1);
await clickPicture(1250, 150);
await footIs(/(^|[^0-9])7 squares would be painted/);
check('the second colour adds its own patch (6 + 1)', (await dm.locator('.dw-slot').count()) === 2 && (await dm.locator('.dw-swatch:not(.empty)').count()) === 2);
await dm.getByRole('button', { name: 'Remove colour 2' }).click();
await footIs(/(^|[^0-9])6 squares would be painted/);
check('Remove takes that colour out again', (await dm.locator('.dw-slot').count()) === 1);
await plus.click();
await clickPicture(1250, 150);
await footIs(/(^|[^0-9])7 squares would be painted/);
await dm.getByLabel('Only the patch I clicked').uncheck();
await footIs(/13 squares would be painted/);
check('with the patch switch off both colours are taken everywhere (12 blue + 1 green)', true);
await dm.getByRole('button', { name: /^Paint 13 squares$/ }).click();
await sleep(700);
const t = await areas();
check('one area of terrain strokes was painted', t.length >= 1 && new Set(t.map((d) => d.hg)).size === 1 && t.every((d) => d.hz === -10 && d.hc === true));
const g = await dm.evaluate(() => { const b = window.__vtt.board; const t = { fly: false, size: 1, x: 0, y: 0 }; const z = (x, y) => b.heightOf(t, { x, y }).ground; return [z(350, 300), z(1000, 650), z(700, 700), z(1250, 150)]; });
check('the pools and the green square are 10 ft down and the floor is level', g[0] === -10 && g[1] === -10 && g[2] === 0 && g[3] === -10, JSON.stringify(g));
await dm.keyboard.press('Control+z');
await sleep(500);
check('one Ctrl+Z takes it back', (await areas()).length === 0);

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
