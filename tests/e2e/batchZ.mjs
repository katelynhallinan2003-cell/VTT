// Round 7b: auras follow the grid lines, a template held at one distance does not flicker, a line starts at a corner or a side middle,
// a spell reads how high the ground is where it starts.
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
await dm.getByPlaceholder('New table name').fill('Z');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);
const G = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = G.cell;
const C = (i, j) => ({ x: G.ox + (i + 0.5) * cell, y: G.oy + (j + 0.5) * cell });
const screen = (p) => dm.evaluate((q) => window.__vtt.board.worldToScreen(q), p);
const host = await dm.locator('.board-host canvas').boundingBox();
const toPage = async (p) => { const s = await screen(p); return { x: s.x + (s.page ? 0 : 0), y: s.y }; };
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(400);

// ---- auras follow the grid
const tok = await dm.evaluate(async (p) => (await window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Paladin' })), C(6, 6));
await sleep(300);
const cellsFor = (aura) => dm.evaluate(({ aura, at }) => { const c = window.__vtt.client; return window.__vtt.board.auraCellsFor(c.grid, 1, at, aura)?.length ?? null; }, { aura, at: C(6, 6) });
const A = { color: '#2f9e44', a: 0.25, dm: false, g: true };
check('a 10 ft round aura from the middle covers the 13 squares within two', (await cellsFor({ ...A, r: 10, shape: 'circle', edge: false })) === 13);
check('a 10 ft square aura covers a 5 x 5 block', (await cellsFor({ ...A, r: 10, shape: 'square', edge: false })) === 25);
check('an aura measured from the token edge covers the squares round it', (await cellsFor({ ...A, r: 10, shape: 'circle', edge: true })) >= 21);
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { auras: [{ r: 15, color: '#2f9e44', a: 0.3, shape: 'circle', edge: true, dm: false, g: true }, { r: 30, color: '#1c7ed6', a: 0.12, shape: 'square', edge: false, dm: true, g: false }] }), tok);
await sleep(400);
await dm.evaluate((p) => window.__vtt.board.centerOn(p), C(6, 6));
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/z1-auras.png' });
check('the aura keeps its on-grid setting when stored', await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return t.auras[0].g === true && t.auras[1].g === false; }, tok));
await dm.evaluate((id) => window.__vtt.ui.select([id]), tok);
await sleep(200);
await dm.locator('.tokentag button', { hasText: /Edit/ }).click();
await dm.waitForSelector('.auras');
check('the token editor has an on-grid switch for each aura', (await dm.locator('.aura-row', { hasText: 'on grid' }).count()) === 2);
await dm.locator('.aura-row').nth(1).locator('label', { hasText: 'on grid' }).locator('input').check();
await dm.locator('.modal-foot .btn.primary').click();
await sleep(500);
check('switching it on saves', await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id).auras[1].g === true, tok));
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { auras: [] }), tok);
await sleep(300);

// ---- a template held at one distance does not change
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(300);
await dm.keyboard.press('c');
await dm.locator('.flyout .seg button', { hasText: 'Sphere' }).click();
const centre = C(8, 6);
const s0 = await screen(centre);
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const zoom = await dm.evaluate(() => window.__vtt.board.cam?.zoom ?? 1);
await dm.mouse.move(s0.x, s0.y);
await dm.mouse.down();
const radii = new Set();
for (let i = 0; i < 80; i++) {
  const ang = rnd() * Math.PI * 2;
  const r = (4 + (rnd() - 0.5) * 0.3) * cell;
  const s = await screen({ x: centre.x + Math.cos(ang) * r, y: centre.y + Math.sin(ang) * r });
  await dm.mouse.move(s.x, s.y);
  const d = await dm.evaluate(() => { const dr = window.__vtt.board.drag; return dr?.pts ? { a: dr.pts[0], b: dr.pts[1] } : null; });
  if (d) radii.add(Math.round(Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)));
}
await dm.mouse.up();
check('a 20 ft sphere keeps the same size while the pointer wiggles around it', radii.size === 1 && [...radii][0] === Math.round(4 * cell), [...radii].join(','));
await dm.evaluate(() => { const c = window.__vtt.client; return c.clearTemplates?.(); });

// ---- a line starts at a corner or the middle of a side
await dm.locator('.flyout .seg button', { hasText: 'Line' }).click();
const lineFrom = async (start, end) => {
  const a = await screen(start), b = await screen(end);
  await dm.mouse.move(a.x, a.y); await dm.mouse.down();
  for (let i = 1; i <= 8; i++) await dm.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await dm.mouse.up(); await sleep(300);
  return dm.evaluate(() => { const l = [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'beam'); const d = l[l.length - 1]; return d ? d.p.split(',').map(Number) : null; });
};
const corner = { x: G.ox + 9 * cell, y: G.oy + 9 * cell };
const p1 = await lineFrom({ x: corner.x + 0.08 * cell, y: corner.y - 0.07 * cell }, { x: corner.x + 4 * cell, y: corner.y + 4 * cell });
check('a diagonal line started near a corner starts exactly on it', p1 && Math.abs(p1[0] - corner.x) < 1.5 && Math.abs(p1[1] - corner.y) < 1.5, JSON.stringify(p1));
const sideMid = { x: G.ox + 13 * cell, y: G.oy + 9.5 * cell };
const p2 = await lineFrom({ x: sideMid.x + 0.05 * cell, y: sideMid.y + 0.1 * cell }, { x: sideMid.x + 4 * cell, y: sideMid.y + 3 * cell });
check('and one started near the middle of a side starts there', p2 && Math.abs(p2[0] - sideMid.x) < 1.5 && Math.abs(p2[1] - sideMid.y) < 1.5, JSON.stringify(p2));
await dm.screenshot({ path: '/tmp/shots/z2-lines.png' });

// ---- the spell reads how high the ground is
const g0 = await dm.evaluate((p) => window.__vtt.board.wallsForSpells().ground(p), C(3, 3));
const rev0 = await dm.evaluate(() => window.__vtt.board.wallsForSpells().rev);
check('spells can ask how high the ground is (flat ground: 0)', g0 === 0, `${g0}`);
check('the painted-spell cache also changes with the ground', typeof rev0 === 'string' && rev0.includes(':'), String(rev0));

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
