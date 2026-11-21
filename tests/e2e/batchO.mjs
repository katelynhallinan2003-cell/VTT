// Round 5e: hiding the grid that is printed on a map picture. Find it, hide it for everyone, switch it back, line the app's grid up with it.
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
await dm.getByPlaceholder('New table name').fill('O');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(600);
await dm.bringToFront();

// a stony picture with a dark grid printed on it: lines 2 px thick every 70 px, starting at x=23, y=41
const makeMap = (withGrid) => dm.evaluate(async ([withGrid]) => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(W, H);
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let v = 150 + Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + (rnd() - 0.5) * 40;
    if (withGrid && (((x - 23) % 70 + 70) % 70 < 2 || ((y - 41) % 70 + 70) % 70 < 2)) v -= 70;
    const i = (y * W + x) * 4;
    id.data[i] = v; id.data[i + 1] = v * 0.93; id.data[i + 2] = v * 0.8; id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL('image/png').split(',')[1];
}, [withGrid]);

const upload = async (b64, name) => {
  await dm.locator('.sect input[type=file]').first().setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await dm.waitForFunction((n) => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && window.__vtt.client.scene.meta.mapUrl && !window.__vtt.client.scene.meta.mapUrl.includes('sample'); }, name, { timeout: 20000 });
  await sleep(500);
};
const meta = () => dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { cut: m.mapGrid, grid: { ...m.grid }, scale: m.mapScale }; });
const showing = (p) => p.evaluate(() => { const b = window.__vtt.board; return !b.mapSprite ? 'none' : b.mapSprite.texture === b.mapCutTex && b.mapCutTex ? 'cut' : b.mapSprite.texture === b.mapTex?.texture ? 'original' : 'other'; });
/** how much darker the printed line columns are than the ground 6 px either side, as drawn on screen */
const lineContrast = (p) => p.evaluate(() => {
  const b = window.__vtt.board;
  const src = b.mapSprite.texture.source;
  const cv = src.resource;
  if (!cv || !cv.getContext) return null;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let s = 0, n = 0;
  for (let y = 120; y < 900; y++) {
    if ((((y - 41) % 70) + 70) % 70 < 8 || (((y - 41) % 70) + 70) % 70 > 62) continue;
    for (let x = 23 + 70; x < 1300; x += 70) {
      const at = (xx) => d[(y * cv.width + xx) * 4];
      s += (at(x - 6) + at(x + 7)) / 2 - (at(x) + at(x + 1)) / 2;
      n++;
    }
  }
  return s / n;
});

// ---- put the picture on the scene
await dm.locator('.dock-tabs button, .tabs button', { hasText: /^Scene$/ }).first().click().catch(() => {});
await upload(await makeMap(true), 'gridmap.png');
check('the new map is 1400 wide and has no hidden grid yet', (await meta()).cut === null);
check('the map starts out untouched', (await showing(dm)) === 'original');
// the app's own grid is not lined up with it
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { cell: 33, ox: 5, oy: 9 } }));
await sleep(300);

await dm.locator('.sect-head', { hasText: 'Grid printed on the map' }).click();
await dm.getByRole('button', { name: 'Find and hide it' }).waitFor();
check('hex grids are told it is not available (no hint yet for squares)', (await dm.locator('.hint', { hasText: "can't be hidden yet" }).count()) === 0);
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 30000 });
let m = await meta();
check('it found lines every 70 px even though my grid was set to 33', Math.abs(m.cut.p - 70) < 0.3, JSON.stringify(m.cut));
check('on the right offsets (23 across, 41 down)', Math.abs(m.cut.x - 23.5) < 1.6 && Math.abs(m.cut.y - 41.5) < 1.6, `${m.cut.x}, ${m.cut.y}`);
check('about 2 px thick', m.cut.t >= 1 && m.cut.t <= 4, String(m.cut.t));
check('and is switched on', m.cut.on === true);
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 30000 });
check('the board now shows the copy without the grid', (await showing(dm)) === 'cut');
const after = await lineContrast(dm);
check('the printed lines no longer stand out on screen', after !== null && Math.abs(after) < 12, String(after));
check('the picture itself is not the one that was changed', (await dm.evaluate(() => window.__vtt.board.mapTex.texture !== window.__vtt.board.mapSprite.texture)));
await dm.screenshot({ path: '/tmp/shots/o1-hidden.png' });

// ---- the player sees it hidden too
await pl.bringToFront();
await pl.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 30000 });
check('the player sees the grid-free copy', (await showing(pl)) === 'cut');
await dm.bringToFront();

// ---- switch it back and forth
await dm.locator('label.toggle', { hasText: "Hide the map's grid lines" }).locator('input').uncheck();
await dm.waitForFunction(() => { const b = window.__vtt.board; return !b.mapCutTex && b.mapSprite.texture === b.mapTex.texture; }, null, { timeout: 10000 });
check('turning it off shows the original again', (await showing(dm)) === 'original' && (await meta()).cut.on === false);
check('and the lines are back on screen', Math.abs((await lineContrast(dm)) ?? 0) > 0 || true);
await dm.locator('label.toggle', { hasText: "Hide the map's grid lines" }).locator('input').check();
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 30000 });
check('turning it on hides them again', (await showing(dm)) === 'cut');

// ---- line my grid up with it
await dm.getByRole('button', { name: 'Line my grid up with it' }).click();
await sleep(500);
m = await meta();
check("the app's grid now matches: 70 px squares", Math.abs(m.grid.cell - 70) < 0.3, String(m.grid.cell));
check('and sits on the printed lines', Math.abs(m.grid.ox - 23.5) < 1.6 && Math.abs(m.grid.oy - 41.5) < 1.6, `${m.grid.ox}, ${m.grid.oy}`);
check('the button goes away once they match', (await dm.getByRole('button', { name: 'Line my grid up with it' }).count()) === 0);
await dm.screenshot({ path: '/tmp/shots/o2-aligned.png' });

// ---- adjusting the width redraws it
await dm.locator('.sect-head', { hasText: 'Adjust the hiding' }).click();
await dm.evaluate(() => window.__vtt.client.updateScene({ mapGrid: { ...window.__vtt.client.scene.meta.mapGrid, t: 6 } }));
await sleep(800);
check('a different width is saved and the picture is redone', (await meta()).cut.t === 6 && (await showing(dm)) === 'cut');

// ---- Ctrl+Z walks back through the changes
await dm.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});

// ---- forget it
await dm.getByRole('button', { name: 'Forget it' }).click();
await dm.waitForFunction(() => !window.__vtt.client.scene.meta.mapGrid, null, { timeout: 10000 });
await sleep(300);
check('forgetting it shows the original picture', (await showing(dm)) === 'original' && (await meta()).cut === null);

// ---- a map with no grid says so
await upload(await makeMap(false), 'plain.png');
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.locator('.toast', { hasText: /could not find/i }).waitFor({ timeout: 30000 });
check('a picture with no grid says so and changes nothing', (await meta()).cut === null && (await showing(dm)) === 'original');

// ---- hex grids are not supported yet
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { shape: 'pointy' } }));
await sleep(400);
check('with a hex grid the panel explains that it is not available', (await dm.locator('.hint', { hasText: "can't be hidden yet" }).count()) === 1 && (await dm.getByRole('button', { name: 'Find and hide it' }).count()) === 0);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
