// Round Z15: the ruler labels every step; spell templates as difficult ground; auto lights; light marks.
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
await dm.getByPlaceholder('New table name').fill('Z15');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { ...window.__vtt.client.scene.meta.grid, rule: 'chebyshev', ft: 5 } }));
await sleep(300);

const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = grid.cell;
const gx = (i) => grid.ox + i * cell;
const gy = (j) => grid.oy + j * cell;
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const labels = () => dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
const drag = async (a, b) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await dm.mouse.move(q.x, q.y, { steps: 5 });
  await dm.mouse.up();
  await sleep(250);
};

// ---- #57: the ruler shows the distance at every step, the first one too
await dm.evaluate(() => window.__vtt.ui.set({ rulerMulti: true }));
await dm.keyboard.press('r');
await drag([gx(10.5), gy(10.5)], [gx(14.5), gy(10.5)]);
let l = await labels();
check('one leg: its distance', l.some((t) => /^20 ft/.test(t)) && l.length === 1, JSON.stringify(l));
await drag([gx(14.5), gy(10.5)], [gx(14.5), gy(13.5)]);
l = await labels();
check('two legs: the first leg\'s distance is on its corner, the total at the end', l.includes('20 ft') && l.some((t) => /^35 ft/.test(t)) && l.length === 2, JSON.stringify(l));
await drag([gx(14.5), gy(13.5)], [gx(11.5), gy(13.5)]);
l = await labels();
check('three legs: every corner has the distance so far', l.includes('20 ft') && l.includes('35 ft') && l.some((t) => /^50 ft/.test(t)) && l.length === 3, JSON.stringify(l));
await dm.screenshot({ path: '/tmp/shots/z15-ruler.png' });
// right-click takes the ruler away (with the ruler tool still on, so no menu opens), then back to the select tool
{ const q = await screen(gx(10.5), gy(10.5)); await dm.mouse.click(q.x, q.y, { button: 'right' }); }
await sleep(200);
await dm.keyboard.press('Escape');

// ---- #56: a spell template marked as difficult ground slows walking while it is there
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'template', tplKind: 'sphere' }));
const roughSwitch = dm.locator('.flyout label', { hasText: 'Counts as difficult ground' }).locator('input');
check('the template panel has "Counts as difficult ground", off to start with', (await roughSwitch.count()) === 1 && !(await roughSwitch.isChecked()));
const roughAt = (gxv, gyv) => dm.evaluate(([x, y]) => window.__vtt.board.isRoughAt({ x, y }), [gx(gxv), gy(gyv)]);
const costOf = (path) => dm.evaluate((pts) => window.__vtt.board.moveCost(pts, false), path.map(([i, j]) => ({ x: gx(i), y: gy(j) })));
await drag([gx(12.5), gy(6.5)], [gx(14.5), gy(6.5)]);
await sleep(300);
const spheres = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'sphere').length);
check('a template was placed', (await spheres()) === 1, JSON.stringify(await dm.evaluate(() => ({ tool: window.__vtt.ui.data.tool, kinds: [...window.__vtt.client.scene.draws.values()].map((d) => d.k) }))));
check('an ordinary template leaves the ground alone', !(await roughAt(12.5, 6.5)) && (await costOf([[8.5, 6.5], [17.5, 6.5]])).ft === 45);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and undone', (await spheres()) === 0);
await roughSwitch.check();
await drag([gx(12.5), gy(6.5)], [gx(14.5), gy(6.5)]);
await sleep(300);
check('a marked template makes the squares it covers difficult', (await roughAt(12.5, 6.5)) && (await roughAt(13.5, 6.5)) && !(await roughAt(17.5, 6.5)));
const through = await costOf([[8.5, 6.5], [17.5, 6.5]]);
check('and a walk through it pays the extra', through.ft > 45 && /difficult ground/.test(through.note), JSON.stringify(through));
await dm.screenshot({ path: '/tmp/shots/z15-rough-template.png' });
// the selected template has the same switch, and turning it off lifts the ground
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
const tplId = await dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].find((d) => d.k === 'sphere').id);
await dm.evaluate((id) => window.__vtt.ui.selectDrawings([id]), tplId);
const tag = dm.locator('.drawtag label', { hasText: 'Difficult ground' }).locator('input');
await tag.waitFor();
check('a selected template shows the switch, on', await tag.isChecked());
await tag.uncheck();
await sleep(400);
check('switching it off makes the ground ordinary again', !(await roughAt(12.5, 6.5)) && (await costOf([[8.5, 6.5], [17.5, 6.5]])).ft === 45);
await tag.check();
await sleep(400);
check('and on again', await roughAt(12.5, 6.5));
await dm.keyboard.press('Delete');
await sleep(400);
check('deleting the template takes the difficult ground with it', !(await roughAt(12.5, 6.5)));
await dm.keyboard.press('Control+z');
await sleep(500);
check('undo brings both back', await roughAt(12.5, 6.5));

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
