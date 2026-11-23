// Round 5f: walls. Draw walls, rooms, doors and windows; doors cut gaps; sight, walking and exploring follow them; edit, undo.
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
await dm.getByPlaceholder('New table name').fill('P');
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
const walls = () => dm.evaluate(() => window.__vtt.client.wallsList().map((w) => ({ id: w.id, a: w.a, b: w.b, k: w.k, open: w.open, vis: w.vis })));
const tok = (id) => dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { x: t.x, y: t.y }; }, id);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const ui = (k) => dm.evaluate((key) => window.__vtt.ui.data[key], k);
const nsel = () => dm.evaluate(() => window.__vtt.ui.data.wallSel.size);
const drag = async (a, b, opts = {}) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  if (opts.key) await dm.keyboard.down(opts.key);
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 5 });
  await dm.mouse.move(q.x, q.y, { steps: 6 });
  await dm.mouse.up();
  if (opts.key) await dm.keyboard.up(opts.key);
  await sleep(350);
};
const click = async (a, opts = {}) => {
  const p = await screen(a[0], a[1]);
  if (opts.button) await dm.mouse.click(p.x, p.y, { button: opts.button });
  else if (opts.dbl) await dm.mouse.dblclick(p.x, p.y);
  else await dm.mouse.click(p.x, p.y);
  await sleep(300);
};

// ---- open the tool
await dm.keyboard.press('b');
await dm.locator('.flyout-title', { hasText: /^Walls$/ }).waitFor();
check('B opens the Walls panel', (await ui('tool')) === 'wall' && (await ui('wallMode')) === 'draw' && (await ui('wallKind')) === 'wall');
check('the toolbar has a Walls button', (await dm.locator('.toolbar button[aria-label^="Walls"]').count()) === 1);
check('the panel offers Wall, Door and Window', (await dm.locator('.flyout .seg button', { hasText: /^(Wall|Door|Window)$/ }).count()) === 3);

// ---- a wall dragged out, then a room clicked point by point
await drag([gx(10), gy(10)], [gx(14), gy(10)]);
let ws = await walls();
check('dragging draws one wall, between grid corners', ws.length === 1 && near(ws[0].a.x, gx(10)) && near(ws[0].a.y, gy(10)) && near(ws[0].b.x, gx(14)) && near(ws[0].b.y, gy(10)), JSON.stringify(ws));
check('it is a plain wall, hidden from the players by default', ws[0].k === 'wall' && ws[0].vis === false && !ws[0].open);
const start = await dm.evaluate(() => window.__vtt.board.wallStart);
check('the next wall carries on from where it stopped', !!start && near(start.x, gx(14)) && near(start.y, gy(10)));
await click([gx(14), gy(14)]);
await click([gx(10), gy(14)]);
await click([gx(10), gy(10)]);
ws = await walls();
check('clicking the corners one after another draws the other three sides', ws.length === 4, `${ws.length}`);
check('coming back to where the run started closes the loop and ends the run', (await dm.evaluate(() => window.__vtt.board.wallStart)) === null && (await walls()).length === 4);
await dm.screenshot({ path: '/tmp/shots/p1-room.png' });

// ---- a door cuts a gap in the wall it is drawn on
await dm.locator('.flyout .seg button', { hasText: /^Door$/ }).click();
check('picking Door switches the kind, and doors are drawn for players by default', (await ui('wallKind')) === 'door' && (await ui('wallVis')) === null);
await drag([gx(11), gy(14)], [gx(12), gy(14)]);
ws = await walls();
const door = ws.find((w) => w.k === 'door');
check('the door is added', !!door && door.vis === true && !door.open);
check('the wall it sits on is split into two pieces (6 walls in all)', ws.length === 6, `${ws.length}`);
const plainBottom = ws.filter((w) => w.k === 'wall' && near(w.a.y, gy(14), 1) && near(w.b.y, gy(14), 1));
check('and neither piece covers the doorway', plainBottom.length === 2 && plainBottom.every((w) => Math.max(w.a.x, w.b.x) <= gx(11) + 1 || Math.min(w.a.x, w.b.x) >= gx(12) - 1), JSON.stringify(plainBottom.map((w) => [w.a.x, w.b.x])));
await dm.locator('.flyout .seg button', { hasText: /^Window$/ }).click();
await drag([gx(14), gy(12)], [gx(14), gy(13)]);
ws = await walls();
check('a window is cut into the right wall (8 walls)', ws.length === 8 && ws.some((w) => w.k === 'window' && w.vis), `${ws.length}`);
const segs = await dm.evaluate(() => { const s = window.__vtt.board.wallSegs(); return { sight: s.sight.length, move: s.move.length }; });
check('closed doors and walls stop sight; windows do not', segs.sight === 7, JSON.stringify(segs));
check('windows stop walking too', segs.move === 8, JSON.stringify(segs));
await dm.screenshot({ path: '/tmp/shots/p2-door-window.png' });

// ---- sight
await dm.keyboard.press('v');
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: true, vision: true, explore: true } }));
const elf = await dm.evaluate(async ([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Elf', size: 1, sight: 30 }), [gx(11.5), gy(12.5)]);
await sleep(1200);
const bounds = () => dm.evaluate(() => { const b = window.__vtt.board.visionG.getLocalBounds(); return { x0: b.minX, x1: b.maxX, y0: b.minY, y1: b.maxY }; });
let b = await bounds();
check('inside a closed room, sight stops at its walls (not the full 6 squares)', b.y0 >= gy(10) - 3 && b.y1 <= gy(14) + 3 && b.x0 >= gx(10) - 3, JSON.stringify(b));
check('but it goes out through the window (a gap), not through the plain wall', b.x1 > gx(14) + cell * 0.5);
await dm.screenshot({ path: '/tmp/shots/p3-sight-closed.png' });
const poly = await dm.evaluate(() => [...window.__vtt.client.scene.fogOps.values()].filter((o) => o.t === 'poly').length);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(500);
const poly2 = await dm.evaluate(() => [...window.__vtt.client.scene.fogOps.values()].filter((o) => o.t === 'poly').length);
check('what the token explores is shaped by the walls too (polygons, not just a line)', poly2 >= 1, `${poly} -> ${poly2}`);

// ---- the DM clicks the door's diamond to open it
await click([gx(11.5), gy(14)]);
ws = await walls();
check('clicking a door opens it', ws.find((w) => w.k === 'door').open === true);
await sleep(200);
b = await bounds();
check('and sight now runs down through the doorway', b.y1 > gy(14) + cell * 2, JSON.stringify(b));
await dm.screenshot({ path: '/tmp/shots/p4-sight-open.png' });
await click([gx(11.5), gy(14)]);
check('clicking again closes it', (await walls()).find((w) => w.k === 'door').open === false);

// ---- walking
const dragTok = async (to) => { await drag([gx(11.5), gy(12.5)], to); };
await dm.evaluate((id) => window.__vtt.ui.select([id]), elf);
await drag([gx(11.5), gy(12.5)], [gx(11.5), gy(8.5)]);
let t = await tok(elf);
check('a token dragged at a wall stops at it', near(t.x, gx(11.5)) && near(t.y, gy(10.5), 3), JSON.stringify(t));
await drag([gx(11.5), gy(10.5)], [gx(11.5), gy(16.5)]);
t = await tok(elf);
check('it stops at a closed door as well, and sits on a square, not half way', near(t.x, gx(11.5)) && near(t.y, gy(13.5), 3), JSON.stringify(t));
await dm.evaluate(() => window.__vtt.client.toggleDoor(window.__vtt.client.wallsList().find((w) => w.k === 'door').id));
await sleep(200);
await drag([gx(11.5), gy(13.5)], [gx(11.5), gy(16.5)]);
t = await tok(elf);
check('an open door lets it through', near(t.y, gy(16.5), 3), JSON.stringify(t));
await dm.evaluate(([id, x, y]) => window.__vtt.client.moveTokens([{ id, x, y }], [], { teleport: true }), [elf, gx(13.5), gy(12.5)]);
await sleep(300);
await drag([gx(13.5), gy(12.5)], [gx(16.5), gy(12.5)]);
t = await tok(elf);
check('a window stops walking', near(t.x, gx(13.5), 3), JSON.stringify(t));
await dm.evaluate(() => window.__vtt.ui.set({ wallIgnore: true }));
await drag([gx(13.5), gy(12.5)], [gx(16.5), gy(12.5)]);
t = await tok(elf);
check('"DM can move tokens through walls" lets the DM drag through', near(t.x, gx(16.5), 3), JSON.stringify(t));
await dm.evaluate(() => window.__vtt.ui.set({ wallIgnore: false }));
await dm.evaluate(([id, x, y]) => window.__vtt.client.moveTokens([{ id, x, y }], [], { teleport: true }), [elf, gx(13.5), gy(12.5)]);
await sleep(300);
await drag([gx(13.5), gy(12.5)], [gx(16.5), gy(12.5)], { key: 'q' });
t = await tok(elf);
check('holding Q lets the DM through too', near(t.x, gx(16.5), 3), JSON.stringify(t));
await dm.evaluate(([id, x, y]) => window.__vtt.client.moveTokens([{ id, x, y }], [], { teleport: true }), [elf, gx(11.5), gy(10.5)]);
await sleep(300);
await dm.evaluate((id) => window.__vtt.ui.select([id]), elf);
await dm.keyboard.press('ArrowUp');
await sleep(300);
t = await tok(elf);
check('the arrow keys stop at walls', near(t.y, gy(10.5), 2), JSON.stringify(t));
await dm.keyboard.press('ArrowDown');
await sleep(300);
t = await tok(elf);
check('and still move the other way', near(t.y, gy(11.5), 2), JSON.stringify(t));

// ---- the panel's scene switches
await dm.keyboard.press('b');
await dm.locator('.flyout-title', { hasText: /^Walls$/ }).waitFor();
const stop = dm.locator('.flyout label', { hasText: "Walls stop the players' tokens" }).locator('input');
check('walls stop the players by default', await stop.isChecked());
await stop.uncheck();
await sleep(300);
check('and that can be turned off for the scene', (await dm.evaluate(() => window.__vtt.client.scene.meta.wallStop)) === false);
await stop.check();
await sleep(300);

// ---- edit mode: select, delete, drag an end, drag a wall, box-select, door double-click, undo
await dm.locator('.flyout .seg button', { hasText: /^Edit$/ }).click();
check('Edit mode is on', (await ui('wallMode')) === 'edit');
const before = (await walls()).length;
await click([gx(12.5), gy(10)]);
check('clicking a wall selects it', (await nsel()) === 1 && (await dm.locator('.ht-card', { hasText: 'Selected wall' }).count()) === 1);
await dm.keyboard.press('Delete');
await sleep(300);
check('Delete removes it', (await walls()).length === before - 1 && (await nsel()) === 0);
await dm.keyboard.press('Control+z');
await sleep(400);
check('Ctrl+Z brings it back', (await walls()).length === before);
// drag the top-right corner: the top wall's end and the right wall's end both come along
const ends = (await walls()).filter((w) => [w.a, w.b].some((p) => near(p.x, gx(14), 1) && near(p.y, gy(10), 1))).length;
await drag([gx(14), gy(10)], [gx(15), gy(9)]);
const moved = (await walls()).filter((w) => [w.a, w.b].some((p) => near(p.x, gx(15), 1.5) && near(p.y, gy(9), 1.5))).length;
check('dragging a corner moves every wall end that meets there', ends === 2 && moved === 2, `${ends} -> ${moved}`);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and Ctrl+Z puts the corner back', (await walls()).filter((w) => [w.a, w.b].some((p) => near(p.x, gx(14), 1) && near(p.y, gy(10), 1))).length === 2);
// drag a whole wall
await dm.keyboard.press('Escape');
await drag([gx(10), gy(12)], [gx(9), gy(12)]);
const left = (await walls()).find((w) => near(w.a.y, gy(10), 1) && near(w.b.y, gy(14), 1) || near(w.b.y, gy(10), 1) && near(w.a.y, gy(14), 1));
check('dragging a wall by its middle moves it a square', !!left && near(left.a.x, gx(9), 1.5) && near(left.b.x, gx(9), 1.5), JSON.stringify(left));
await dm.keyboard.press('Control+z');
await sleep(400);
// box-select everything
await dm.keyboard.press('Escape');
await drag([gx(9), gy(8.5)], [gx(15.5), gy(15.5)]);
check('dragging a box selects the walls inside it', (await nsel()) === (await walls()).length, `${(await nsel())} of ${(await walls()).length}`);
await dm.screenshot({ path: '/tmp/shots/p5-selected.png' });
await dm.keyboard.press('Escape');
// double-click a door in edit mode
const doorBefore = (await walls()).find((w) => w.k === 'door').open;
await click([gx(11.5), gy(14)], { dbl: true });
check('double-clicking a door in Edit mode flips it open or shut', (await walls()).find((w) => w.k === 'door').open === !doorBefore);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and that undoes', (await walls()).find((w) => w.k === 'door').open === doorBefore);

// ---- Esc and right-click while drawing
await dm.locator('.flyout .seg button', { hasText: /^Draw$/ }).click();
await dm.locator('.flyout .seg button', { hasText: /^Wall$/ }).click();
await click([gx(17), gy(10)]);
check('a first click marks where a wall will start', !!(await dm.evaluate(() => window.__vtt.board.wallStart)));
await dm.keyboard.press('Escape');
check('Esc lets go of it and stays in the tool', (await dm.evaluate(() => window.__vtt.board.wallStart)) === null && (await ui('tool')) === 'wall');
await click([gx(17), gy(10)]);
await click([gx(17), gy(10)], { button: 'right' });
check('right-click lets go of it too', (await dm.evaluate(() => window.__vtt.board.wallStart)) === null && (await walls()).length === before);
await dm.keyboard.press('Escape');
check('the next Esc leaves the tool', (await ui('tool')) === 'select');

// ---- boxes
await dm.keyboard.press('b');
await dm.locator('.flyout .seg button', { hasText: /^Box/ }).click();
await drag([gx(17), gy(10)], [gx(20), gy(13)]);
check('a box is four walls', (await walls()).length === before + 4);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and one Ctrl+Z takes the whole room back', (await walls()).length === before);
await dm.locator('.flyout .seg button', { hasText: /^Lines$/ }).click();

// ---- snapping
await dm.locator('.flyout .seg button', { hasText: /^Halves too/ }).click();
await drag([gx(17.45), gy(10.55)], [gx(19.45), gy(10.55)]);
let last = (await walls()).at(-1);
const half = (v, o) => near(((v - o) / (cell / 2)) % 1 + 1, 1, 0.01) || near(((v - o) / (cell / 2)) % 1, 0, 0.01);
check('Halves too snaps a wall end to the middle of a side', !!last && half(last.a.x, grid.ox) && half(last.a.y, grid.oy), JSON.stringify(last));
await dm.keyboard.press('Control+z');
await sleep(300);
await dm.locator('.flyout .seg button', { hasText: /^Free$/ }).click();
await drag([gx(17.31), gy(10.27)], [gx(19.31), gy(10.27)]);
last = (await walls()).at(-1);
check('Free leaves it exactly where you put it', !!last && near(last.a.x, gx(17.31), 2.5) && near(last.a.y, gy(10.27), 2.5), JSON.stringify(last));
await dm.keyboard.press('Control+z');
await sleep(300);
await dm.locator('.flyout .seg button', { hasText: /^Halves too/ }).click();

// ---- clear all, and bring them back
const clear = dm.locator('.flyout button', { hasText: /^Clear all walls$/ });
await clear.click();
await sleep(500);
check('Clear all walls empties the map', (await walls()).length === 0);
await dm.keyboard.press('Control+z');
await sleep(500);
check('and one Ctrl+Z brings every wall back', (await walls()).length === before);

// ---- a spell is stopped by the walls (look at it)
await dm.keyboard.press('v');
await dm.evaluate(() => window.__vtt.ui.set({ tplCover: true, tool: 'template', tplKind: 'sphere' }));
await sleep(200);
await drag([gx(12), gy(12)], [gx(12) + cell * 4, gy(12)]);
await dm.keyboard.press('v');
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/p6-spell.png' });

console.log('\nerrors:', errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)).join('\n') || 'none');
const bad = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) && !bad.length ? 0 : 1);
