// Round 7g: a second map in the same scene.
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
await dm.getByPlaceholder('New table name').fill('Z6');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);
const main = await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { x: m.mapX, y: m.mapY, w: m.mapW * m.mapScale, h: m.mapH * m.mapScale }; });
const maps = () => dm.evaluate(() => window.__vtt.client.scene.meta.maps.map((m) => ({ ...m })));
if (!(await dm.locator('.sect-head').count())) await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
await dm.locator('.sect-head').first().waitFor();

// a second picture: 700 x 500, red with a white cross so it can be told apart
const png = await dm.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 700; c.height = 500;
  const g = c.getContext('2d'); g.fillStyle = '#b03a2e'; g.fillRect(0, 0, 700, 500); g.strokeStyle = '#fff'; g.lineWidth = 12;
  g.beginPath(); g.moveTo(0, 0); g.lineTo(700, 500); g.moveTo(700, 0); g.lineTo(0, 500); g.stroke();
  return c.toDataURL('image/png').split(',')[1];
});
check('the Map section offers to add a second map', (await dm.getByText('Add a second map…').count()) === 1);
await dm.locator('.sect input[type=file]').nth(1).setInputFiles({ name: 'upstairs.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
await dm.waitForFunction(() => window.__vtt.client.scene.meta.maps.length === 1, null, { timeout: 20000 });
await dm.waitForFunction(() => { const e = [...window.__vtt.board.extras.values()][0]; return e && e.sprite.natScale; }, null, { timeout: 20000 });
await sleep(400);
let ms = await maps();
check('it is there, called "upstairs", 700 x 500, to the right of the first', ms.length === 1 && ms[0].name === 'upstairs' && ms[0].w === 700 && ms[0].h === 500 && Math.abs(ms[0].x - (main.x + main.w)) < 1 && Math.abs(ms[0].y - main.y) < 1, JSON.stringify(ms[0]));
check('it starts unlocked and selected so it can be put in place', ms[0].locked === false && (await dm.evaluate(() => window.__vtt.ui.data.extraSel)) === ms[0].id);
check('the scene now takes in both maps', await dm.evaluate((m) => { const r = window.__vtt.client.sceneRect(); return Math.abs(r.w - (m.w + 700)) < 1; }, main));
await sleep(600);
await dm.screenshot({ path: '/tmp/shots/z6-two-maps.png' });

// ---- drag it to a new place
const id = ms[0].id;
// the panel floats over the right of the board, so pick a spot of the map that is clear of it
const clearSpot = (m, dx, dy) => dm.evaluate(([m, dx, dy]) => {
  const B = window.__vtt.board;
  const ok = (p) => { const s = B.worldToScreen(p); const e = document.elementFromPoint(s.x, s.y); return !!e && e.tagName === 'CANVAS'; };
  for (let fy = 0.5; fy <= 0.9; fy += 0.1) for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
    const w = m.w * m.scale, h = m.h * m.scale;
    const p = { x: m.x + w * fx, y: m.y + h * fy };
    if (ok(p) && ok({ x: p.x + dx, y: p.y + dy })) return p;
  }
  return null;
}, [m, dx, dy]);
const from = await clearSpot(ms[0], -140, 70);
check('part of the second map is in view beside the panel', !!from);
const a = await dm.evaluate((p) => window.__vtt.board.worldToScreen(p), from);
const to = { x: from.x - 140, y: from.y + 70 };
const b = await dm.evaluate((p) => window.__vtt.board.worldToScreen(p), to);
await dm.mouse.move(a.x, a.y); await dm.mouse.down();
for (let i = 1; i <= 10; i++) await dm.mouse.move(a.x + ((b.x - a.x) * i) / 10, a.y + ((b.y - a.y) * i) / 10);
await dm.mouse.up(); await sleep(500);
ms = await maps();
check('dragging it moves it (140 left, 70 down)', Math.abs(ms[0].x - (main.x + main.w - 140)) < 2 && Math.abs(ms[0].y - (main.y + 70)) < 2, `${ms[0].x}, ${ms[0].y}`);

// ---- size and lock from the panel
await dm.locator('.extra-map .slider input[type=range], .extra-map input[type=range]').first().evaluate((el) => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(700);
ms = await maps();
check('the Size slider resizes it (50%)', Math.abs(ms[0].scale - 0.5) < 0.01, String(ms[0].scale));
await dm.locator('.extra-map label.toggle', { hasText: 'Locked in place' }).locator('input').check();
await sleep(400);
check('locking it keeps it from being picked up', (await maps())[0].locked === true && (await dm.evaluate(() => window.__vtt.ui.data.extraSel)) === null);
const here = await maps();
const spot = await clearSpot(here[0], 60, 30);
const c0 = await dm.evaluate((p) => window.__vtt.board.worldToScreen(p), spot);
await dm.mouse.move(c0.x, c0.y); await dm.mouse.down(); await dm.mouse.move(c0.x + 60, c0.y + 30, { steps: 5 }); await dm.mouse.up(); await sleep(300);
check('and a drag on it then does not move it', Math.abs((await maps())[0].x - here[0].x) < 0.01);

// ---- players
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: true }));
await sleep(400);
const vis = () => dm.evaluate(() => { const e = [...window.__vtt.board.extras.values()][0]; return { v: e.sprite.visible, a: e.sprite.alpha }; });
let v = await vis();
check('players see it', v.v === true && v.a === 1, JSON.stringify(v));
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: false }));
await dm.locator('.extra-map label.toggle', { hasText: 'Players can see it' }).locator('input').uncheck();
await sleep(400);
v = await vis();
check('hidden from players, you still see it, faded', v.v === true && v.a < 1, JSON.stringify(v));
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: true }));
await sleep(400);
v = await vis();
check('and in the player preview it is gone', v.v === false, JSON.stringify(v));
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: false }));
await dm.locator('.extra-map label.toggle', { hasText: 'Players can see it' }).locator('input').check();

// ---- fog covers both maps
await dm.evaluate(() => window.__vtt.client.resetFog('hidden'));
await sleep(500);
const fogOk = await dm.evaluate(() => { const m = window.__vtt.board.fogMask; const r = window.__vtt.client.sceneRect(); return m.worldW >= r.w - 1 && m.worldH >= r.h - 1 && m.origin.x <= r.x + 1; });
check('the fog covers the whole scene, both maps', fogOk);

// ---- remove it, Ctrl+Z brings it back
await dm.locator('.extra-map .btn', { hasText: 'Remove' }).click();
await sleep(500);
check('Remove takes it off the scene', (await maps()).length === 0 && (await dm.evaluate(() => window.__vtt.board.extras.size)) === 0);
await dm.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
await dm.keyboard.press('Control+z');
await sleep(600);
check('and Ctrl+Z puts it back', (await maps()).length === 1 && (await dm.evaluate(() => window.__vtt.board.extras.size)) === 1);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
