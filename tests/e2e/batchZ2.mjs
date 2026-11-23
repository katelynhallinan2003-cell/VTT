// Round 7c: test move and ruler in several steps; right-click goes back one step.
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
await dm.getByPlaceholder('New table name').fill('Z2');
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
const near = (a, b, t = 2) => Math.abs(a.x - b.x) <= t && Math.abs(a.y - b.y) <= t;
const dragTo = async (from, to) => {
  const a = await screen(from), b = await screen(to);
  await dm.mouse.move(a.x, a.y); await dm.mouse.down();
  for (let i = 1; i <= 8; i++) await dm.mouse.move(a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8);
  await dm.mouse.up(); await sleep(250);
};
const rightClick = async (p) => { const s = await screen(p); await dm.mouse.click(s.x, s.y, { button: 'right' }); await sleep(250); };
const tm = (id) => dm.evaluate((id) => { const m = window.__vtt.board.testMoves.get(id); return m ? { from: m.from, to: m.to, via: m.via } : null; }, id);

await dm.evaluate(() => window.__vtt.board.fit());
await sleep(300);
const tok = await dm.evaluate(async (p) => (await window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Scout' })), C(3, 3));
await sleep(400);
const realPos = () => dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { x: t.x, y: t.y }; }, tok);

// ---- test move in several steps
await dm.keyboard.press('m');
check('the test-move bar has a "Multi-step" switch, off by default', (await dm.locator('.testbar', { hasText: 'Multi-step' }).count()) === 1 && (await dm.evaluate(() => window.__vtt.ui.data.testMulti)) === false);
await dragTo(C(3, 3), C(6, 3));
await dragTo(C(6, 3), C(6, 7));
let m = await tm(tok);
check('without it a second drag replaces the first (no corners)', m && m.via.length === 0 && near(m.to, C(6, 7)), JSON.stringify(m && m.via));
await dm.locator('.testbar button', { hasText: 'Reset' }).click();
await sleep(300);
await dm.locator('.testbar label', { hasText: 'Multi-step' }).locator('input').check();
check('the switch is remembered', await dm.evaluate(() => localStorage.getItem('vtt-test-multi') === '1' && window.__vtt.ui.data.testMulti === true));
await dragTo(C(3, 3), C(6, 3));
await dragTo(C(6, 3), C(6, 7));
m = await tm(tok);
check('with it the second drag adds a leg: the first stop is a corner', m && m.via.length === 1 && near(m.via[0], C(6, 3)) && near(m.to, C(6, 7)) && near(m.from, C(3, 3)), JSON.stringify(m));
check('the real token has not moved', near(await realPos(), C(3, 3)));
await dm.screenshot({ path: '/tmp/shots/z2-multi.png' });
const shown = () => dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
const ftOf = (t) => parseFloat(t);
let lab = await shown();
check('a two-step test move shows each step and the total', lab.length === 3 && lab.filter((t) => / total$/.test(t)).length === 1, JSON.stringify(lab));
const steps = lab.filter((t) => !/ total/.test(t)).map(ftOf), whole = lab.filter((t) => / total$/.test(t)).map(ftOf)[0];
check('the steps are 15 ft and 20 ft and add up to the total', steps.length === 2 && Math.abs(steps[0] + steps[1] - whole) < 0.11 && steps[0] > 0 && steps[1] > 0, JSON.stringify(lab));
await dragTo(C(6, 7), C(2, 7));
m = await tm(tok);
check('a third leg makes two corners', m && m.via.length === 2 && near(m.to, C(2, 7)), JSON.stringify(m && m.via));
lab = await shown();
const three = lab.filter((t) => !/ total/.test(t)).map(ftOf), whole3 = lab.filter((t) => / total$/.test(t)).map(ftOf)[0];
check('three steps are each shown and add up to the total', three.length === 3 && Math.abs(three.reduce((a, b) => a + b, 0) - whole3) < 0.2, JSON.stringify(lab));
// sharing it
await dm.evaluate(() => window.__vtt.ui.set({ sharePlot: true }));
await sleep(500);
const live = await dm.evaluate((id) => { const g = window.__vtt.client.liveMine.ghosts[id]; return g ? { via: g.via?.length ?? 0 } : null; }, tok);
check('others are sent the corners too', live && live.via === 2, JSON.stringify(live));
await dm.evaluate(() => window.__vtt.ui.set({ sharePlot: false }));
// back one step with the right button
await rightClick(C(10, 10));
m = await tm(tok);
check('right-click goes back one step', m && m.via.length === 1 && near(m.to, C(6, 7)), JSON.stringify(m));
check('and does not open the menu', (await dm.locator('.ctx').count()) === 0);
await rightClick(C(10, 10));
await rightClick(C(10, 10));
check('the last right-click puts the token back where it started', (await tm(tok)) === null && (await dm.evaluate((id) => window.__vtt.board.views.get(id).testPos, tok)) === null);
check('and nothing is left to go back to', (await dm.evaluate(() => window.__vtt.board.stepBackTest())) === false);
// keep a multi-step move
await dragTo(C(3, 3), C(6, 3));
await dragTo(C(6, 3), C(6, 5));
await dm.keyboard.press('Enter');
await sleep(500);
check('Keep moves the token to the end of the path', near(await realPos(), C(6, 5)));
// arrow keys count as steps too
await dm.evaluate((id) => window.__vtt.ui.select([id]), tok);
await dm.keyboard.press('ArrowRight');
await dm.keyboard.press('ArrowRight');
m = await tm(tok);
check('arrow keys add steps', m && m.via.length === 1 && near(m.to, C(8, 5)), JSON.stringify(m));
await rightClick(C(12, 12));
m = await tm(tok);
check('and right-click goes back over them', m && m.via.length === 0 && near(m.to, C(7, 5)), JSON.stringify(m));
await dm.keyboard.press('Escape');
await sleep(300);
await dm.keyboard.press('m');

// ---- ruler in several steps
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'ruler' }));
await sleep(300);
check('the ruler panel has a "several steps" switch', (await dm.locator('.flyout', { hasText: 'Measure in several steps' }).count()) === 1);
const rl = () => dm.evaluate(() => { const r = window.__vtt.board.ruler; return r ? { a: r.a, b: r.b, via: r.via } : null; });
await dragTo(C(8, 2), C(11, 2));
await dragTo(C(8, 4), C(8, 7));
let r = await rl();
check('without it a new drag starts a new measurement', r && r.via.length === 0 && near(r.a, C(8, 4)), JSON.stringify(r));
await dm.locator('.flyout label', { hasText: 'Measure in several steps' }).locator('input').check();
await rightClick(C(16, 10)); // clear the measurement that is still there
check('right-click clears a one-leg measurement', (await rl()) === null);
await dragTo(C(8, 2), C(11, 2));
await dragTo(C(11, 2), C(11, 6));
r = await rl();
check('with it the next drag carries on from the end of the last leg', r && r.via.length === 1 && near(r.via[0], C(11, 2)) && near(r.b, C(11, 6)) && near(r.a, C(8, 2)), JSON.stringify(r));
await dm.screenshot({ path: '/tmp/shots/z2-ruler.png' });
await dragTo(C(11, 6), C(7, 6));
r = await rl();
check('a third leg adds a second corner', r && r.via.length === 2 && near(r.b, C(7, 6)), JSON.stringify(r && r.via));
const dist = await dm.evaluate(() => { const r = window.__vtt.board.ruler; const g = window.__vtt.client.grid; return window.__vtt.board.pathLen ? null : null; });
await rightClick(C(16, 9));
r = await rl();
check('right-click takes back the last leg', r && r.via.length === 1 && near(r.b, C(11, 6)), JSON.stringify(r));
await dm.mouse.move(0, 0);
// shift starts again
{ const a = await screen(C(14, 8)), b = await screen(C(16, 8));
  await dm.keyboard.down('Shift'); await dm.mouse.move(a.x, a.y); await dm.mouse.down();
  for (let i = 1; i <= 6; i++) await dm.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y); await dm.mouse.up(); await dm.keyboard.up('Shift'); await sleep(250); }
r = await rl();
check('Shift+drag starts a new measurement', r && r.via.length === 0 && near(r.a, C(14, 8)), JSON.stringify(r));
await rightClick(C(16, 9));
check('and right-click on a single leg clears it', (await rl()) === null);
// a tiny drag in several-step mode does not add a leg
await dragTo(C(8, 2), C(11, 2));
{ const a = await screen(C(11, 2)); await dm.mouse.move(a.x, a.y); await dm.mouse.down(); await dm.mouse.move(a.x + 2, a.y); await dm.mouse.up(); await sleep(200); }
r = await rl();
check('a tiny extra drag adds nothing', r && r.via.length === 0 && near(r.b, C(11, 2)), JSON.stringify(r));
// sharing the ruler sends its corners
await dragTo(C(11, 2), C(11, 5));
await dm.evaluate(() => window.__vtt.ui.set({ sharePlot: true }));
await sleep(500);
check('a shared ruler sends its corners', await dm.evaluate(() => window.__vtt.client.liveMine.ruler?.via?.length === 1));
await dm.keyboard.press('Escape');

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
