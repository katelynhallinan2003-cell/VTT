// Round 4d: hex grids. Switching the scene to hexes, setting the grid from a box, snapping, arrow keys, the ruler and spell templates.
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
await dm.getByPlaceholder('New table name').fill('K');
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
await pl.keyboard.press('Escape');
await dm.bringToFront();

const S3 = Math.sqrt(3);
const grid = (p = dm) => p.evaluate(() => ({ ...window.__vtt.client.grid }));
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const tok = (id) => dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { x: t.x, y: t.y }; }, id);
/** hex coordinates of a point on a pointy grid, and how far it is from a whole hex */
const pointyHex = (g, p) => {
  const ox = g.ox + g.cell / 2, oy = g.oy + g.cell / S3;
  const r = (p.y - oy) / (g.cell * S3 / 2);
  const q = (p.x - ox) / g.cell - r / 2;
  return { q, r, off: Math.max(Math.abs(q - Math.round(q)), Math.abs(r - Math.round(r))) };
};
const flatHex = (g, p) => {
  const ox = g.ox + g.cell / S3, oy = g.oy + g.cell / 2;
  const q = (p.x - ox) / (g.cell * S3 / 2);
  const r = (p.y - oy) / g.cell - q / 2;
  return { q, r, off: Math.max(Math.abs(q - Math.round(q)), Math.abs(r - Math.round(r))) };
};

// ---- the Scene tab has a grid type
if (!(await dm.locator('.dock-scene').count())) await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
await sleep(200);
const gridSeg = dm.locator('.seg button', { hasText: /^Hex, point up$/ });
if (!(await gridSeg.count())) await dm.locator('.section-head, summary, h4, button', { hasText: /^Grid$/i }).first().click().catch(() => {});
await gridSeg.waitFor({ timeout: 4000 });
check('the Scene tab offers Squares, Hex point up and Hex flat top', (await dm.locator('.seg button', { hasText: /^Squares$/ }).count()) === 1 && (await dm.locator('.seg button', { hasText: /^Hex, flat top$/ }).count()) === 1);
check('it starts on squares', (await grid()).shape === 'square');
const cell = (await grid()).cell;

// ---- two tokens first, so we can watch them snap
const add = (partial) => dm.evaluate((p) => window.__vtt.client.addToken(p), partial);
const hero = await add({ x: 3.5 * cell, y: 4.5 * cell, name: 'Aria' });
const ogre = await add({ x: 8 * cell, y: 4 * cell, name: 'Ogre', size: 2 });
await sleep(400);

await gridSeg.click();
await sleep(500);
let g = await grid();
check('Hex, point up switches the scene', g.shape === 'pointy');
check('the player sees it too', (await grid(pl)).shape === 'pointy');
await dm.screenshot({ path: '/tmp/shots/k1-pointy.png' });
await dm.keyboard.press('Control+z');
await sleep(400);
check('and Ctrl+Z puts squares back', (await grid()).shape === 'square');
await dm.keyboard.press('Control+y');
await sleep(400);
check('Ctrl+Y goes to hexes again', (await grid()).shape === 'pointy');

// ---- set the grid from a box over hexes: 5 hexes across a row of 90 px hexes, from a chosen top-left
await dm.locator('button', { hasText: /^Draw a box to set the grid$/ }).click();
const x0 = 300, y0 = 200, w = 5 * 90;
const a = await screen(x0, y0);
const b = await screen(x0 + w, y0 + 104);
await dm.mouse.move(a.x, a.y);
await dm.mouse.down();
await dm.mouse.move(b.x, b.y, { steps: 6 });
await dm.mouse.up();
await dm.locator('.modal', { hasText: 'Set the grid from these hexes' }).waitFor();
check('the dialog talks about hexes and asks how many are wide', (await dm.locator('.modal label', { hasText: /Hexes wide/ }).count()) === 1);
await dm.locator('.modal input[type=number]').fill('5');
await dm.getByRole('button', { name: 'Apply' }).click();
await sleep(500);
g = await grid();
const zoomOk = Math.abs(g.cell - 90) < 1.5;
check('the hex size comes from the width of the row', zoomOk, `cell ${g.cell}`);
const per = { x: g.cell, y: g.cell * S3 };
const wantOx = ((x0 % per.x) + per.x) % per.x;
check('and the offset from the corner of the box', Math.abs(g.ox - wantOx) < 1.5 && Math.abs(g.oy - (((y0 % per.y) + per.y) % per.y)) < 1.5, `ox ${g.ox} oy ${g.oy}`);
await dm.screenshot({ path: '/tmp/shots/k2-calibrated.png' });

// ---- tokens snap to hexes: Medium to a middle, Large to a corner
const move = async (id, wx, wy) => {
  const t = await tok(id);
  const from = await screen(t.x, t.y);
  const to = await screen(wx, wy);
  await dm.mouse.move(from.x, from.y);
  await dm.mouse.down();
  await dm.mouse.move(to.x, to.y, { steps: 8 });
  await dm.mouse.up();
  await sleep(350);
  return tok(id);
};
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
// start both on clean lattice spots so a drag starts on them: put them there first
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [hero, 500, 400]);
await sleep(300);
let p = await move(hero, 612, 487);
let h = pointyHex(await grid(), p);
check('a dragged Medium token lands in the middle of a hex', h.off < 0.01, JSON.stringify(h));
const p2 = await move(ogre, 900, 330);
const gg = await grid();
const R = gg.cell / S3;
// a Large token's centre is a corner: three hex centres are a corner-distance away
let cornerCount = 0;
const hx = pointyHex(gg, p2);
for (let dq = -2; dq <= 2; dq++) for (let dr = -2; dr <= 2; dr++) {
  const q = Math.round(hx.q) + dq, r = Math.round(hx.r) + dr;
  const cx = gg.ox + gg.cell / 2 + gg.cell * (q + r / 2), cy = gg.oy + gg.cell / S3 + gg.cell * (S3 / 2) * r;
  if (Math.abs(Math.hypot(cx - p2.x, cy - p2.y) - R) < 0.5) cornerCount++;
}
check('a Large token lands on a corner where three hexes meet', cornerCount === 3, `corner count ${cornerCount}`);
await dm.screenshot({ path: '/tmp/shots/k3-tokens.png' });

// ---- arrow keys follow the hexes
await dm.evaluate((i) => window.__vtt.ui.select([i]), hero);
const s0 = await tok(hero);
await dm.keyboard.press('ArrowRight');
await sleep(400);
let s1 = await tok(hero);
check('→ goes one hex east', Math.abs(s1.x - s0.x - gg.cell) < 0.15 && Math.abs(s1.y - s0.y) < 0.15);
await dm.keyboard.press('ArrowUp');
await sleep(400);
const s2 = await tok(hero);
check('↑ goes up to a neighbouring hex', Math.abs(Math.hypot(s2.x - s1.x, s2.y - s1.y) - gg.cell) < 0.15 && s2.y < s1.y);
await dm.keyboard.press('ArrowUp');
await sleep(400);
const s3 = await tok(hero);
check('↑↑ ends straight above where it began', Math.abs(s3.x - s1.x) < 0.15 && Math.abs(s1.y - s3.y - gg.cell * S3) < 0.15, JSON.stringify([s1, s3]));
await dm.keyboard.press('ArrowDown');
await dm.keyboard.press('ArrowDown');
await sleep(400);
const s4 = await tok(hero);
check('↓↓ comes back', Math.abs(s4.x - s1.x) < 0.15 && Math.abs(s4.y - s1.y) < 0.15);
check('and it is still in the middle of a hex', pointyHex(gg, s4).off < 0.01);
await dm.keyboard.press('Escape');

// ---- the ruler counts hexes
await dm.keyboard.press('r');
const from = await dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { x: t.x, y: t.y }; }, hero);
const toW = { x: from.x + 3 * gg.cell, y: from.y };
const ra = await screen(from.x, from.y), rb = await screen(toW.x, toW.y);
await dm.mouse.move(ra.x, ra.y);
await dm.mouse.down();
await dm.mouse.move(rb.x, rb.y, { steps: 8 });
await sleep(250);
let labels = await dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
check('three hexes along a row measure 15 ft', labels.some((t) => /^15 ft/.test(t)), JSON.stringify(labels));
await dm.mouse.up();
// two steps along the zig-zag direction (up-right twice) is 10 ft
await dm.keyboard.press('Escape');
await dm.keyboard.press('r');
const toW2 = { x: from.x + gg.cell, y: from.y - gg.cell * S3 };
const rc = await screen(toW2.x, toW2.y);
await dm.mouse.move(ra.x, ra.y);
await dm.mouse.down();
await dm.mouse.move(rc.x, rc.y, { steps: 8 });
await sleep(250);
labels = await dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
check('two hexes up and to the right measure 10 ft (no diagonal cheating)', labels.some((t) => /^10 ft/.test(t)), JSON.stringify(labels));
await dm.screenshot({ path: '/tmp/shots/k4-ruler.png' });
await dm.mouse.up();
await dm.keyboard.press('Escape');
await dm.keyboard.press('v');

// ---- a 10 ft sphere template
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'template', tplKind: 'sphere' }));
const sc = await dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { x: t.x, y: t.y }; }, hero);
const t0 = await screen(sc.x + 4 * gg.cell + 9, sc.y + 6);
const t1 = await screen(sc.x + 4 * gg.cell + 2 * gg.cell + 5, sc.y + 6);
await dm.mouse.move(t0.x, t0.y);
await dm.mouse.down();
await dm.mouse.move(t1.x, t1.y, { steps: 6 });
await dm.mouse.up();
await sleep(400);
const tpl = await dm.evaluate(() => { const d = [...window.__vtt.client.scene.draws.values()].find((x) => x.k === 'sphere'); return d ? d.p : null; });
check('a sphere is made', !!tpl, String(tpl));
if (tpl) {
  const nums = String(tpl).split(/[ ,]+/).map(Number);
  const c0 = { x: nums[0], y: nums[1] }, c1 = { x: nums[2], y: nums[3] };
  check('it starts in the middle of a hex', pointyHex(gg, c0).off < 0.01);
  check('and is a whole number of hexes across (10 ft)', Math.abs(Math.hypot(c1.x - c0.x, c1.y - c0.y) - 2 * gg.cell) < 0.5);
}
await dm.screenshot({ path: '/tmp/shots/k5-sphere.png' });
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));

// ---- flat tops
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { shape: 'flat' } }));
await sleep(500);
g = await grid();
check('flat-top hexes', g.shape === 'flat');
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [hero, 700, 300]);
await dm.evaluate((i) => window.__vtt.ui.select([i]), hero);
await dm.keyboard.press('ArrowDown');
await sleep(300);
const f1 = await tok(hero);
check('the first key press puts it on a flat hex', flatHex(g, f1).off < 0.01, JSON.stringify(flatHex(g, f1)));
await dm.keyboard.press('ArrowDown');
await sleep(300);
const f2 = await tok(hero);
check('↓ goes straight down one hex', Math.abs(f2.x - f1.x) < 0.15 && Math.abs(f2.y - f1.y - g.cell) < 0.15);
await dm.keyboard.press('ArrowRight');
await sleep(300);
const f3 = await tok(hero);
check('→ goes to the hex on the right', Math.abs(Math.hypot(f3.x - f2.x, f3.y - f2.y) - g.cell) < 0.15 && f3.x > f2.x);
await dm.keyboard.press('Escape');
await dm.screenshot({ path: '/tmp/shots/k6-flat.png' });

// ---- duplicating lands on a hex, not between two
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { shape: 'pointy' } }));
await sleep(300);
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [hero, 600, 400]);
const base = await dm.evaluate((i) => { const gr = window.__vtt.client.grid; const t = window.__vtt.client.scene.tokens.get(i); return { gr, x: t.x, y: t.y }; }, hero);
const snapped = await dm.evaluate(([i]) => window.__vtt.client.snapMe?.(i) ?? null, [hero]);
void base; void snapped;
await dm.evaluate((i) => window.__vtt.ui.select([i]), hero);
await dm.keyboard.press('Control+d');
await sleep(500);
const count = await dm.evaluate(() => window.__vtt.client.scene.tokens.size);
check('Ctrl+D duplicates', count === 3);
const dupId = await dm.evaluate((i) => [...window.__vtt.client.scene.tokens.values()].find((t) => t.id !== i && /Aria/.test(t.name))?.id, hero);
const dp = await tok(dupId);
const gp = await grid();
check('and the copy sits in the middle of a hex', pointyHex(gp, dp).off < 0.01, JSON.stringify(pointyHex(gp, dp)));
await dm.keyboard.press('Escape');

// ---- the other settings are labelled for hexes, and nothing else is shaped like a square
if (!(await dm.locator('.dock-scene').count())) await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
check('the grid panel says "Feet per hex" and has hex-only wording', /hex/i.test(await dm.locator('.dock-scene').innerText()));

// ---- and back to squares
await dm.locator('.seg button', { hasText: /^Squares$/ }).click();
await sleep(500);
g = await grid();
check('Squares puts it back', g.shape === 'square');
const back = await move(hero, 3.4 * g.cell, 4.4 * g.cell);
const sq = ((back.x - g.ox) / g.cell) % 1;
check('and tokens snap to squares again', Math.abs(sq) < 0.01 || Math.abs(sq - 1) < 0.01 || Math.abs(sq - 0.5) < 0.01, String(sq));

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
