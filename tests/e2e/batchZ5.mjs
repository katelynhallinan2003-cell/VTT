// Round 7f: a new map is looked at once; a printed grid is hidden and the app's grid is set on it. Hiding is more precise.
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
await dm.getByPlaceholder('New table name').fill('Z5');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(600);

// stony picture, soft (anti-aliased) lines 2.4 px thick every 70.4 px, starting at x=23.3, y=41.6
const makeMap = (withGrid) => dm.evaluate(async ([withGrid]) => {
  const W = 1400, H = 1000, P = 70.4, OX = 23.3, OY = 41.6, T = 2.4;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(W, H);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const cover = (x, o) => { const k = Math.round((x - o) / P); const m = o + k * P; return Math.max(0, Math.min(x + 0.5, m + T / 2) - Math.max(x - 0.5, m - T / 2)); };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 150 + Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + (rnd() - 0.5) * 30;
    if (withGrid) v -= 70 * Math.min(1, cover(x, OX) + cover(y, OY));
    const i = (y * W + x) * 4;
    id.data[i] = v; id.data[i + 1] = v * 0.93; id.data[i + 2] = v * 0.8; id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}, [withGrid]);
const upload = async (b64, name) => {
  await dm.locator('.sect input[type=file]').first().setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && window.__vtt.client.scene.meta.mapUrl && !window.__vtt.client.scene.meta.mapUrl.includes('sample'); }, null, { timeout: 20000 });
};
const meta = () => dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { cut: m.mapGrid, grid: { ...m.grid }, tried: m.gridTried }; });
await dm.locator('.rail-tab', { hasText: 'Scene' }).click().catch(() => {});
if (!(await dm.locator('.sect-head').count())) await dm.locator('.rail-tab', { hasText: 'Scene' }).click();

// ---- a new map with a grid on it: found, hidden, and the app's grid set on it, with no button pressed
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { cell: 33, ox: 5, oy: 9 } }));
await upload(await makeMap(true), 'softgrid.png');
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 40000 });
await sleep(500);
let m = await meta();
check('a new map is looked at once, and its printed grid is found without asking', !!m.cut && m.tried === true, JSON.stringify(m.cut));
check('it found the spacing to a hundredth of a pixel or so (70.4)', Math.abs(m.cut.p - 70.4) < 0.05, String(m.cut.p));
check('and the app grid is set to it: size and place', Math.abs(m.grid.cell - 70.4) < 0.1 && Math.abs(m.grid.ox - 23.8) < 1 && Math.abs(m.grid.oy - 42.1) < 1, JSON.stringify(m.grid));
check('and the board says so', (await dm.locator('.toast', { hasText: /printed on it/ }).count()) >= 1);
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 30000 });
// how much is left of the lines on screen: compare the line pixels with the pixels beside them
const leftover = await dm.evaluate(() => {
  const b = window.__vtt.board; const cv = b.mapSprite.texture.source.resource; const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const P = 70.4, OX = 23.3;
  let s = 0, n = 0;
  for (let y = 120; y < 900; y++) {
    const dy = ((y - 41.6) % P + P) % P; if (dy < 8 || dy > P - 8) continue;
    for (let k = 2; k < 19; k++) { const x = Math.round(OX + k * P); const at = (xx) => d[(y * cv.width + xx) * 4]; s += (at(x - 6) + at(x + 6)) / 2 - at(x); n++; }
  }
  return s / n;
});
check('the printed lines are gone on screen (under 8 of the 70 they were darker by)', Math.abs(leftover) < 8, String(leftover));
await dm.screenshot({ path: '/tmp/shots/z5-auto.png' });

// ---- one Ctrl+Z puts both back
await dm.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
await dm.keyboard.press('Control+z');
await sleep(600);
m = await meta();
check('Ctrl+Z puts back the grid and un-hides the lines in one go', m.cut === null && Math.abs(m.grid.cell - 33) < 0.1, JSON.stringify({ cut: m.cut, cell: m.grid.cell }));
await dm.keyboard.press('Control+y');
await sleep(600);
m = await meta();
check('and Ctrl+Y does them again', !!m.cut && Math.abs(m.grid.cell - 70.4) < 0.1);

// ---- a plain map is left alone, and so is the grid
await dm.evaluate(() => window.__vtt.client.updateScene({ mapGrid: null, grid: { cell: 61, ox: 3, oy: 4 } }));
await upload(await makeMap(false), 'plain.png');
await sleep(2500);
m = await meta();
check('a map with no grid changes nothing', m.cut === null && Math.abs(m.grid.cell - 61) < 0.01 && m.tried === true, JSON.stringify(m));

// ---- switched off: nothing is looked for
await dm.evaluate(() => window.__vtt.ui.set({ autoGrid: false }));
await upload(await makeMap(true), 'again.png');
await sleep(2500);
m = await meta();
check('with "Look for a printed grid when I add a map" off, nothing is done', m.cut === null && Math.abs(m.grid.cell - 61) < 0.01 && m.tried === true, JSON.stringify(m));
if (!(await dm.getByText('Look for a printed grid when I add a map').count())) await dm.locator('.sect-head', { hasText: 'Grid printed on the map' }).click();
check('the setting is in the panel', (await dm.getByText('Look for a printed grid when I add a map').count()) >= 1);

// ---- the button does both too
await dm.evaluate(() => window.__vtt.ui.set({ autoGrid: true }));
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 30000 });
await sleep(500);
m = await meta();
check('"Find and hide it" sets the grid as well', !!m.cut && Math.abs(m.grid.cell - 70.4) < 0.1, JSON.stringify(m.grid));

// ---- a hex map added to a square scene: found as hexes, and the scene turns into a hex scene on them
const makeHex = () => dm.evaluate(async () => {
  const W = 1400, H = 1000, p = 90, ox = 33, oy = 21;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); const id = ctx.createImageData(W, H);
  let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 150 + Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + (rnd() - 0.5) * 40; const i = (y * W + x) * 4; id.data[i] = v; id.data[i + 1] = v * 0.93; id.data[i + 2] = v * 0.8; id.data[i + 3] = 255; }
  ctx.putImageData(id, 0, 0);
  const R = p / Math.sqrt(3); ctx.strokeStyle = 'rgba(20,10,0,0.55)'; ctx.lineWidth = 2;
  for (let r = -2; r < H / (1.5 * R) + 3; r++) for (let q = -2; q < W / p + 3; q++) {
    const cx = ox + p / 2 + q * p + (r & 1) * p / 2, cy = oy + R + r * 1.5 * R;
    ctx.beginPath();
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + k * Math.PI / 3; const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.closePath(); ctx.stroke();
  }
  return c.toDataURL('image/png').split(',')[1];
});
await dm.evaluate(() => window.__vtt.client.updateScene({ mapGrid: null, grid: { shape: 'square', cell: 50, ox: 0, oy: 0 } }));
await upload(await makeHex(), 'hexes.png');
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 60000 });
await sleep(500);
m = await meta();
check('a hex map is found as hexes even though the scene was square', m.cut?.hex === 'pointy' && Math.abs(m.cut.p - 90) < 0.6, JSON.stringify(m.cut));
check('and the scene becomes a hex scene sized to them', m.grid.shape === 'pointy' && Math.abs(m.grid.cell - 90) < 0.6, JSON.stringify(m.grid));

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
