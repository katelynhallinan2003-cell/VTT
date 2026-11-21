// Spell templates on the grid (2024 rules): emanation centred on a square, cone from an edge middle, cubes and lines on whole squares.
import { launch, watch, sleep } from './lib.mjs';
const BASE = (process.env.BASE || 'http://127.0.0.1:4174/') + '?demo';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const { browser, context } = await launch();
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.evaluate(() => localStorage.clear());
await dm.reload();
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('F');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
await sleep(400);

const draws = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));
const toScreen = (x, y) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [x, y]);
const g = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const c = g.cell;
const world = (cx, cy) => ({ x: g.ox + cx * c, y: g.oy + cy * c });
async function drag(kind, from, to, mods = []) {
  await dm.locator('.flyout .seg button', { hasText: kind }).first().click();
  const a = await toScreen(from.x, from.y), b = await toScreen(to.x, to.y);
  await dm.mouse.move(a.x, a.y); await dm.mouse.down(); await dm.mouse.move(b.x, b.y, { steps: 6 });
  await dm.mouse.up(); await sleep(250);
}
await dm.keyboard.press('s');
check('template flyout has an Emanation button', (await dm.locator('.flyout .seg button', { hasText: 'Emanation' }).count()) === 1);

// emanation: click inside the square at (13,9), drag about 2.4 squares right
await drag('Emanation', world(13.3, 9.4), world(15.8, 9.5));
let list = await draws();
let p = list[list.length - 1].p.split(',').map(Number);
check('emanation is centred on the middle of a square', Math.abs(p[0] - (g.ox + 13.5 * c)) < 0.2 && Math.abs(p[1] - (g.oy + 9.5 * c)) < 0.2, `${(p[0] - g.ox) / c},${(p[1] - g.oy) / c}`);
const r = Math.hypot(p[2] - p[0], p[3] - p[1]) / c;
check('and it reaches whole squares past the edge of that square', Math.abs(r - 2.5) < 0.01 || Math.abs(r - 3.5) < 0.01, `radius ${r.toFixed(2)} squares`);
await dm.screenshot({ path: '/tmp/shots/80-emanation.png' });

// cone: from near the middle of an edge, going right
await drag('Cone', world(10.1, 4.52), world(13.1, 4.5));
list = await draws();
p = list[list.length - 1].p.split(',').map(Number);
const u = (p[0] - g.ox) / c, v = (p[1] - g.oy) / c;
const onVLine = Math.abs(u - Math.round(u)) < 0.01 && Math.abs(v - Math.floor(v) - 0.5) < 0.01;
const onHLine = Math.abs(v - Math.round(v)) < 0.01 && Math.abs(u - Math.floor(u) - 0.5) < 0.01;
check('a cone starts in the middle of a grid line', onVLine || onHLine, `${u.toFixed(2)},${v.toFixed(2)}`);
check('cone length is whole squares', Math.abs(Math.hypot(p[2] - p[0], p[3] - p[1]) / c - 3) < 0.05);

// cube 3 squares to the right: its face centre is mid-square, and the cube covers whole squares
await drag('Cube', world(10.08, 7.3), world(13.1, 7.4));
list = await draws();
p = list[list.length - 1].p.split(',').map(Number);
const cu = (p[0] - g.ox) / c, cv = (p[1] - g.oy) / c;
check('a 15 ft cube sits on grid lines', Math.abs(cu - Math.round(cu)) < 0.01 && Math.abs(cv - Math.floor(cv) - 0.5) < 0.01, `${cu.toFixed(2)},${cv.toFixed(2)}`);

// line 10 ft wide
await dm.locator('.flyout .seg button', { hasText: 'Line' }).first().click();
await dm.locator('.flyout select').selectOption('10');
await drag('Line', world(10.1, 11.2), world(14.1, 11.3));
list = await draws();
p = list[list.length - 1].p.split(',').map(Number);
const lv = (p[1] - g.oy) / c;
check('a 10 ft wide line straddles a grid line (covers two whole rows)', Math.abs(lv - Math.round(lv)) < 0.01, `v=${lv.toFixed(2)}`);
await dm.screenshot({ path: '/tmp/shots/81-templates.png' });

// select + the template panel shows a size in feet; dragging the end dot retargets it
await dm.keyboard.press('v');
const e = list[list.length - 1];
await dm.evaluate((id) => window.__vtt.ui.selectDrawings([id]), e.id);
await sleep(200);
check('selected template shows a length box', (await dm.locator('.drawtag .numf', { hasText: 'Length' }).count()) === 1);
await dm.locator('.drawtag .numf', { hasText: 'Length' }).locator('input').fill('30');
await dm.locator('.drawtag .numf', { hasText: 'Length' }).locator('input').press('Enter'); await sleep(250);
const l2 = (await draws()).find((d) => d.id === e.id).p.split(',').map(Number);
check('typed length sets the template length', Math.abs(Math.hypot(l2[2] - l2[0], l2[3] - l2[1]) / c * 5 - 30) < 0.3);

// emanation size is counted from the square's edge
const em = list.find((d) => d.k === 'emanation');
await dm.evaluate((id) => window.__vtt.ui.selectDrawings([id]), em.id);
await sleep(200);
const sizeBox = await dm.locator('.drawtag .numf', { hasText: 'Length' }).locator('input').inputValue();
check('an emanation reports its size from the edge of its square', Math.abs(Number(sizeBox) - (Math.hypot(...[em.p.split(',').map(Number)].map((q) => [q[2] - q[0], q[3] - q[1]])[0]) / c - 0.5) * 5) < 0.2, `size box ${sizeBox} ft`);

console.log(errors.filter((e) => !/GPU stall|ReadPixels/.test(e)).join('\n') || 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.some((e) => /pageerror/.test(e)) ? 0 : 1);
