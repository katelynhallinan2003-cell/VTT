// Round 6c: walls. One-way walls (cliff edges), wall heights, freehand and round walls, adding and taking out corners.
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
await dm.getByPlaceholder('New table name').fill('S');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = grid.cell;
const gx = (i) => grid.ox + i * cell;
const gy = (j) => grid.oy + j * cell;
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const walls = () => dm.evaluate(() => window.__vtt.client.wallsList().map((w) => ({ id: w.id, a: w.a, b: w.b, k: w.k, one: w.one, h: w.h, vis: w.vis })));
const tok = (id) => dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { x: t.x, y: t.y, fly: t.fly, elev: t.elev }; }, id);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const ui = (k) => dm.evaluate((key) => window.__vtt.ui.data[key], k);
const allowed = (from, to, id) => dm.evaluate(([f, t, i]) => window.__vtt.board.moveAllowed(f, t, i), [from, to, id]);
const clearWalls = async () => { await dm.evaluate(() => window.__vtt.client.removeWalls(window.__vtt.client.wallsList().map((w) => w.id))); await sleep(300); };
const path = async (pts, opts = {}) => {
  const first = await screen(pts[0][0], pts[0][1]);
  await dm.mouse.move(first.x, first.y);
  await dm.mouse.down();
  for (const p of pts.slice(1)) { const q = await screen(p[0], p[1]); await dm.mouse.move(q.x, q.y, { steps: opts.steps ?? 3 }); }
  await dm.mouse.up();
  await sleep(400);
};
const drag = (a, b) => path([a, b], { steps: 6 });
const dbl = async (a) => { const p = await screen(a[0], a[1]); await dm.mouse.dblclick(p.x, p.y); await sleep(400); };
const click = async (a) => { const p = await screen(a[0], a[1]); await dm.mouse.click(p.x, p.y); await sleep(250); };
const labels = () => dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));

// ---- the panel
await dm.keyboard.press('b');
await dm.locator('.flyout-title', { hasText: /^Walls$/ }).waitFor();
check('the panel offers Lines, Box, Freehand and Round', (await dm.locator('.flyout .seg button', { hasText: /^(Lines|Box|Freehand|Round)$/ }).count()) === 4);
check('and a One-way switch and a Height box', (await dm.locator('.flyout label.toggle', { hasText: 'One-way' }).count()) === 1 && (await dm.locator('.flyout .numf', { hasText: 'Height' }).count()) === 1);
await dm.locator('.flyout .seg button', { hasText: /^Door$/ }).click();
check('doors are always one piece: no shape or one-way choices for them', (await dm.locator('.flyout .seg button', { hasText: /^Freehand$/ }).count()) === 0 && (await dm.locator('.flyout label.toggle', { hasText: 'One-way' }).count()) === 0);
await dm.locator('.flyout .seg button', { hasText: /^Wall$/ }).click();

// ---- a one-way wall along a cliff edge
await dm.locator('.flyout label.toggle', { hasText: 'One-way' }).click();
check('turning on One-way picks a side to stop', (await ui('wallOne')) === 1 && (await dm.locator('.flyout .seg button', { hasText: /^Stops its right$/ }).count()) === 1);
await drag([gx(10), gy(10)], [gx(16), gy(10)]);
let ws = await walls();
check('the wall drawn is one-way, stopping its right (the screen-down side)', ws.length === 1 && ws[0].one === 1 && ws[0].h === 0, JSON.stringify(ws));
await dm.screenshot({ path: '/tmp/shots/s1-oneway.png' });
const below = await dm.evaluate(async ([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Below' }), [gx(12.5), gy(12.5)]);
const above = await dm.evaluate(async ([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Above' }), [gx(14.5), gy(7.5)]);
await sleep(500);
check('from the bottom, a step up through it is stopped', (await allowed({ x: gx(12.5), y: gy(12.5) }, { x: gx(12.5), y: gy(8.5) }, below)) === false);
check('from the top, a step down through it is not', (await allowed({ x: gx(14.5), y: gy(7.5) }, { x: gx(14.5), y: gy(12.5) }, above)) === true);
check('walking alongside it is free either way', (await allowed({ x: gx(12.5), y: gy(12.5) }, { x: gx(15.5), y: gy(12.5) }, below)) === true);

// really dragging the tokens
await dm.keyboard.press('v');
await drag([gx(12.5), gy(12.5)], [gx(12.5), gy(8.5)]);
let t = await tok(below);
check('dragging the one at the bottom up stops it below the wall', t.y > gy(10) && t.y < gy(12.6), JSON.stringify(t));
await drag([gx(14.5), gy(7.5)], [gx(14.5), gy(12.5)]);
t = await tok(above);
check('dragging the one at the top down goes through (it drops off the edge)', near(t.y, gy(12.5), 3), JSON.stringify(t));

// ---- sight follows the same rule
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: true, vision: true, explore: false } }));
await dm.evaluate(([a, b]) => { window.__vtt.client.updateToken(a, { sight: 40, x: window.__vtt.client.grid.ox + 12.5 * window.__vtt.client.grid.cell, y: window.__vtt.client.grid.oy + 12.5 * window.__vtt.client.grid.cell }); window.__vtt.client.updateToken(b, { sight: 0 }); }, [below, above]);
await sleep(900);
const sees = (x, y) => dm.evaluate(([px, py]) => window.__vtt.board.visionG.containsPoint({ x: px, y: py }), [x, y]);
check('the one at the bottom sees the floor around it', await sees(gx(12.5), gy(12.5) + cell));
check('but nothing straight past the wall', !(await sees(gx(12.5), gy(8.5))));
await dm.evaluate(([a, c]) => { window.__vtt.client.updateToken(a, { sight: 0 }); window.__vtt.client.updateToken(c, { sight: 40, x: window.__vtt.client.grid.ox + 12.5 * window.__vtt.client.grid.cell, y: window.__vtt.client.grid.oy + 7.5 * window.__vtt.client.grid.cell }); }, [below, above]);
await sleep(900);
check('the one at the top sees down over the edge', await sees(gx(12.5), gy(12.5)));
check('and the ground up there', await sees(gx(12.5), gy(6.5)));
await dm.screenshot({ path: '/tmp/shots/s2-oneway-sight.png' });
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: false } }));

// ---- editing: flip the side, switch one-way off
await dm.keyboard.press('b');
await dm.locator('.flyout .seg button', { hasText: /^Edit$/ }).click();
await click([gx(13), gy(10)]);
check('clicking the wall selects it and the panel shows its one-way switch', (await dm.evaluate(() => window.__vtt.ui.data.wallSel.size)) === 1 && (await dm.locator('.ht-card label.toggle', { hasText: 'One-way' }).count()) === 1);
await dm.keyboard.press('x');
await sleep(400);
ws = await walls();
check('X flips the stopped side', ws[0].one === -1, JSON.stringify(ws[0]));
check('now the one at the bottom may go up', (await allowed({ x: gx(12.5), y: gy(12.5) }, { x: gx(12.5), y: gy(8.5) }, below)) === true);
check('and the one at the top is stopped', (await allowed({ x: gx(14.5), y: gy(7.5) }, { x: gx(14.5), y: gy(12.5) }, above)) === false);
await dm.locator('.ht-card button', { hasText: /^Flip the stopped side/ }).click();
await sleep(300);
check('the Flip button does the same', (await walls())[0].one === 1);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and Ctrl+Z puts it back', (await walls())[0].one === -1);
await dm.locator('.ht-card label.toggle', { hasText: 'One-way' }).click();
await sleep(300);
check('switching One-way off makes it stop both sides again', (await walls())[0].one === 0 && (await allowed({ x: gx(14.5), y: gy(7.5) }, { x: gx(14.5), y: gy(12.5) }, above)) === false && (await allowed({ x: gx(12.5), y: gy(12.5) }, { x: gx(12.5), y: gy(8.5) }, below)) === false);
await clearWalls();

// ---- a wall with a height: flyers go over it
await dm.locator('.flyout .seg button', { hasText: /^Draw$/ }).click();
await dm.locator('.flyout label.toggle', { hasText: 'One-way' }).click(); // off again
check('One-way is off again for the next walls', (await ui('wallOne')) === 0);
await dm.locator('.flyout .numf', { hasText: 'Height' }).locator('input').fill('10');
await dm.locator('.flyout .numf', { hasText: 'Height' }).locator('input').blur();
check('the Height box sets how tall the next wall is', (await ui('wallH')) === 10);
await drag([gx(10), gy(16)], [gx(16), gy(16)]);
ws = await walls();
check('the wall is 10 ft tall', ws.length === 1 && ws[0].h === 10 && ws[0].one === 0, JSON.stringify(ws));
const topNow = await dm.evaluate(() => window.__vtt.board.wallSegs().move.map((s) => s.top));
check('its top is 10 ft above the ground (0 here)', topNow.length === 1 && topNow[0] === 10, JSON.stringify(topNow));
await dm.evaluate(([x, y]) => window.__vtt.client.updateToken(x, { x: window.__vtt.client.grid.ox + 12.5 * window.__vtt.client.grid.cell, y: window.__vtt.client.grid.oy + 17.5 * window.__vtt.client.grid.cell, sight: 0 }), below);
await sleep(300);
const from = { x: gx(12.5), y: gy(17.5) }, to = { x: gx(12.5), y: gy(14.5) };
const cost = (f, t, fly, z = 0) => dm.evaluate(([a,b,flies,height]) => window.__vtt.board.moveCost([a,b],flies,height),[f,t,fly,z]);
const across = await cost(from,to,false), back = await cost(to,from,false);
check('a walker crosses a ten-foot freestanding wall in either direction', await allowed(from,to,below) && across.ft === 35 && across.note === '15 ft normal + 20 ft climbing' && back.ft === across.ft, JSON.stringify(across));
await dm.evaluate((i) => window.__vtt.client.updateToken(i, { fly: true, elev: 5 }), below);
await sleep(300);
check('a low flyer pays to clear the wall', await allowed(from,to,below) && (await cost(from,to,true,5)).ft > 15);
await dm.evaluate((i) => window.__vtt.client.updateToken(i, { fly: true, elev: 15 }), below);
await sleep(300);
check('a flyer 15 ft up goes right over', (await allowed(from, to, below)) === true);
// the top follows the ground the wall stands on
await dm.keyboard.press('Escape');
await dm.keyboard.press('h');
await dm.evaluate(() => window.__vtt.ui.set({ heightMode: 'paint', heightSnap: true, heightBrush: 2, heightFt: 20, heightAdds: false }));
await drag([gx(12.5), gy(15.5)], [gx(13.5), gy(15.5)]);
await dm.evaluate(() => window.__vtt.ui.selectDrawings([]));
await dm.keyboard.press('v');
await sleep(500);
const ground = await dm.evaluate(([x, y]) => window.__vtt.board.groundAtPoint({ x, y }), [gx(13), gy(16)]);
const top2 = await dm.evaluate(() => window.__vtt.board.wallSegs().move.map((s) => s.top));
check('on 20 ft ground, a 10 ft wall reaches 30', ground === 20 && top2[0] === 30, JSON.stringify({ ground, top2 }));
check('a flyer at 15 ft must climb over the raised wall', await allowed(from,to,below) && (await cost(from,to,true,15)).ft > 15);
await dm.evaluate((i) => window.__vtt.client.updateToken(i, { fly: true, elev: 35 }), below);
await sleep(300);
check('and one at 35 passes', (await allowed(from, to, below)) === true);
await dm.evaluate((i) => window.__vtt.client.updateToken(i, { fly: false, elev: 0 }), below);
// sight over a wall: a high flyer sees over it
await dm.keyboard.press('b');
await dm.locator('.flyout .seg button', { hasText: /^Edit$/ }).click();
await click([gx(11), gy(16)]);
check('selecting a tall wall says how tall', (await labels()).some((l) => /10 ft tall/.test(l)), JSON.stringify(await labels()));
await dm.locator('.ht-card .numf', { hasText: 'Height' }).locator('input').fill('25');
await dm.locator('.ht-card .numf', { hasText: 'Height' }).locator('input').blur();
await sleep(300);
check('the selected wall\'s height can be changed', (await walls())[0].h === 25);
await dm.locator('.ht-card .numf', { hasText: 'Height' }).locator('input').fill('0');
await dm.locator('.ht-card .numf', { hasText: 'Height' }).locator('input').blur();
await sleep(300);
check('0 makes it too tall to get over', (await walls())[0].h === 0);
await dm.evaluate(() => window.__vtt.ui.set({ wallH: 0 }));
await dm.keyboard.press('Escape');
await clearWalls();
await dm.evaluate(() => window.__vtt.client.clearDrawings((x) => x.hz != null || x.k === 'terrain', 'Clear all heights'));
await sleep(300);

// ---- freehand walls
await dm.locator('.flyout .seg button', { hasText: /^Draw$/ }).click();
await dm.locator('.flyout .seg button', { hasText: /^Freehand$/ }).click();
check('Freehand shows the number of corners', (await dm.locator('.flyout .seg button', { hasText: /^(Few|Some|Many)$/ }).count()) === 3);
const arc = Array.from({ length: 25 }, (_, i) => [gx(10) + (i / 24) * 8 * cell, gy(10) + Math.sin((i / 24) * Math.PI) * 3 * cell].map((v, k) => (k ? v : v)));
await path(arc.map(([x, y]) => [x / 1, y / 1].map((v, k) => (k === 0 ? (v - grid.ox) / cell : (v - grid.oy) / cell))).map(([i, j]) => [gx(i), gy(j)]), { steps: 2 });
ws = await walls();
const chained = ws.every((w, i) => i === 0 || (near(w.a.x, ws[i - 1].b.x, 0.2) && near(w.a.y, ws[i - 1].b.y, 0.2)));
check('a hand-drawn curve becomes a chain of walls', ws.length >= 3 && ws.length <= 24 && chained, `${ws.length}`);
check('and they are not forced onto the grid', ws.some((w) => !near(((w.b.x - grid.ox) / cell) % 0.5, 0, 0.02) || !near(((w.b.y - grid.oy) / cell) % 0.5, 0, 0.02)));
const nSome = ws.length;
await dm.screenshot({ path: '/tmp/shots/s3-freehand.png' });
await dm.keyboard.press('Control+z');
await sleep(400);
check('one Ctrl+Z takes the whole stroke back', (await walls()).length === 0);
await dm.locator('.flyout .seg button', { hasText: /^Many$/ }).click();
await path(arc.map(([x, y]) => [gx((x - grid.ox) / cell), gy((y - grid.oy) / cell)]), { steps: 2 });
const nMany = (await walls()).length;
await dm.keyboard.press('Control+z');
await sleep(300);
await dm.locator('.flyout .seg button', { hasText: /^Few$/ }).click();
await path(arc.map(([x, y]) => [gx((x - grid.ox) / cell), gy((y - grid.oy) / cell)]), { steps: 2 });
const nFew = (await walls()).length;
check('Many corners gives more walls than Some, and Few no more than Some', nMany > nSome && nFew <= nSome && nFew < nMany, `${nFew} / ${nSome} / ${nMany}`);
await dm.keyboard.press('Control+z');
await sleep(300);
// a loop closes
await dm.locator('.flyout .seg button', { hasText: /^Some$/ }).click();
const loop = Array.from({ length: 41 }, (_, i) => { const a = (i / 40) * Math.PI * 2; return [gx(22 + Math.cos(a) * 2.5), gy(13 + Math.sin(a) * 2)]; });
await path(loop, { steps: 2 });
ws = await walls();
const closed = ws.length >= 5 && near(ws[0].a.x, ws[ws.length - 1].b.x, 0.5) && near(ws[0].a.y, ws[ws.length - 1].b.y, 0.5);
check('coming back to the start closes the loop', closed, `${ws.length}`);
await dm.keyboard.press('Control+z');
await sleep(300);

// ---- round rooms
await dm.locator('.flyout .seg button', { hasText: /^Round$/ }).click();
await drag([gx(22), gy(13)], [gx(24), gy(13)]);
ws = await walls();
check('a round room is twenty walls ("Some")', ws.length === 20, `${ws.length}`);
const radii = ws.map((w) => Math.hypot(w.a.x - gx(22), w.a.y - gy(13)));
check('all on a circle of the radius dragged', radii.every((r) => near(r, 2 * cell, 1)), JSON.stringify(radii.slice(0, 3)));
check('and they join up in a loop', ws.every((w, i) => near(w.b.x, ws[(i + 1) % ws.length].a.x, 0.2) && near(w.b.y, ws[(i + 1) % ws.length].a.y, 0.2)));
await dm.screenshot({ path: '/tmp/shots/s4-round.png' });
await dm.keyboard.press('Control+z');
await sleep(300);
check('Ctrl+Z takes the whole room back at once', (await walls()).length === 0);
await dm.locator('.flyout .seg button', { hasText: /^Many$/ }).click();
await dm.locator('.flyout label.toggle', { hasText: 'One-way' }).click();
await drag([gx(22), gy(13)], [gx(24), gy(13)]);
ws = await walls();
check('Many corners makes 32, and a one-way round room is one-way all round', ws.length === 32 && ws.every((w) => w.one === 1), `${ws.length}`);
await dm.keyboard.press('Control+z');
await sleep(300);
await dm.locator('.flyout label.toggle', { hasText: 'One-way' }).click();

// ---- clicking round to the start closes the loop and ends the run
await dm.locator('.flyout .seg button', { hasText: /^Lines$/ }).click();
await click([gx(20), gy(18)]);
await click([gx(23), gy(18)]);
await click([gx(23), gy(21)]);
check('clicking points carries the run on', (await dm.evaluate(() => window.__vtt.board.wallStart)) !== null && (await walls()).length === 2);
await click([gx(20), gy(18)]);
check('coming back to the first point makes the third wall and ends the run', (await walls()).length === 3 && (await dm.evaluate(() => window.__vtt.board.wallStart)) === null);
await dm.keyboard.press('Control+z');
await sleep(250);
await dm.keyboard.press('Control+z');
await sleep(250);
await dm.keyboard.press('Control+z');
await sleep(250);
check('undone one wall at a time', (await walls()).length === 0);

// ---- add and take out a corner
await dm.locator('.flyout .seg button', { hasText: /^Lines$/ }).click();
await drag([gx(10), gy(20)], [gx(16), gy(20)]);
await dm.keyboard.press('Escape');
await dm.locator('.flyout .seg button', { hasText: /^Edit$/ }).click();
await dbl([gx(13), gy(20)]);
ws = await walls();
check('double-clicking a wall gives it a corner there (two walls)', ws.length === 2 && near(ws[0].b.x, gx(13)) && near(ws[1].a.x, gx(13)), JSON.stringify(ws.map((w) => [w.a.x, w.b.x])));
check('and selects both pieces', (await dm.evaluate(() => window.__vtt.ui.data.wallSel.size)) === 2);
// drag the new corner to bend the wall
await drag([gx(13), gy(20)], [gx(13), gy(22)]);
ws = await walls();
const bent = ws.some((w) => near(w.b.y, gy(22)) || near(w.a.y, gy(22)));
check('dragging the corner bends the wall, both pieces following', bent && ws.filter((w) => near(w.a.y, gy(22)) || near(w.b.y, gy(22))).length === 2);
await dbl([gx(13), gy(22)]);
ws = await walls();
check('double-clicking the corner takes it out again (one wall)', ws.length === 1 && near(ws[0].a.x, gx(10)) && near(ws[0].b.x, gx(16)), JSON.stringify(ws.map((w) => [w.a, w.b])));
await dm.keyboard.press('Control+z');
await sleep(400);
check('Ctrl+Z puts the corner back', (await walls()).length === 2);
await dm.keyboard.press('Control+z');
await sleep(300);
await dm.keyboard.press('Control+z');
await sleep(300);
check('and more Ctrl+Z undoes the bend and the split', (await walls()).length === 1);

const bad = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
if (bad.length) console.log('ERRORS:\n' + bad.join('\n'));
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) && !bad.length ? 0 : 1);
