// Round 7d: difficult ground, ramps, cliffs and stairs.
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
await dm.getByPlaceholder('New table name').fill('Z3');
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
const dragTo = async (from, to, mods = []) => {
  const a = await screen(from), b = await screen(to);
  await dm.mouse.move(a.x, a.y); await dm.mouse.down();
  const n = 10;
  for (let i = 1; i <= n; i++) await dm.mouse.move(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n);
  await dm.mouse.up(); await sleep(300);
};
const ground = (p) => dm.evaluate((q) => window.__vtt.board.groundAtPoint(q), p);
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(300);

// ---- difficult ground
await dm.keyboard.press('h');
check('the Heights panel offers difficult ground', (await dm.locator('.flyout button', { hasText: 'Diff Terrain' }).count()) === 1);
await dm.locator('.flyout button', { hasText: 'Diff Terrain' }).click();
check('and then only paints and erases', (await dm.locator('.flyout .seg button', { hasText: 'Ramp' }).count()) === 0 && (await dm.locator('.flyout .seg button', { hasText: 'Select' }).count()) === 0);
await dragTo(C(8, 6), C(11, 6));
const nRough = await dm.evaluate(() => window.__vtt.board.rough.areas.length);
check('painting makes one difficult area', nRough === 1, `${nRough}`);
check('it did not change the height of the ground', (await ground(C(9, 6))) === 0 && (await dm.evaluate(() => window.__vtt.board.zones.areas.length)) === 0);
const cells = await dm.evaluate(() => { const a = window.__vtt.board.rough.areas[0]; return a.paint.reduce((n, s) => n + (s.cells?.size ?? 0), 0); });
check('four squares of it', cells === 4, `${cells}`);
await dm.screenshot({ path: '/tmp/shots/z3-rough.png' });
// walking through it costs extra
const tok = await dm.evaluate(async (p) => (await window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Walker' })), C(6, 6));
await sleep(400);
await dm.keyboard.press('Escape');
await dm.keyboard.press('v');
const a0 = await screen(C(6, 6)), b0 = await screen(C(13, 6));
await dm.mouse.move(a0.x, a0.y); await dm.mouse.down();
for (let i = 1; i <= 12; i++) await dm.mouse.move(a0.x + ((b0.x - a0.x) * i) / 12, a0.y);
const label = await dm.evaluate(() => window.__vtt.board.distText.text);
await dm.screenshot({ path: '/tmp/shots/z3-rough-drag.png' });
await dm.mouse.up(); await sleep(300);
check('dragging a token across it says what it costs: 35 ft plus 4 squares', /55 ft/.test(label) && /difficult ground \+20 ft/.test(label), label);
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { fly: true, elev: 10 }), tok);
await sleep(300);
const fl = await dm.evaluate(([id]) => { const b = window.__vtt.board; const t = window.__vtt.client.scene.tokens.get(id); return b.moveCost([{ x: t.x, y: t.y }, { x: t.x + 7 * 70, y: t.y }], true); }, [tok]);
check('a flyer is not slowed by it', fl.ft === 35 && fl.note === '', JSON.stringify(fl));
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { fly: false, elev: 0 }), tok);
// erase
await dm.keyboard.press('h');
await dm.locator('.flyout .seg button', { hasText: 'Erase' }).click();
await dragTo(C(9, 6), C(10, 6));
const cells2 = await dm.evaluate(() => { const b = window.__vtt.board; return [8, 9, 10, 11].filter((i) => { const p = { x: b.client.grid.ox + (i + 0.5) * b.client.grid.cell, y: b.client.grid.oy + 6.5 * b.client.grid.cell }; return window.__vtt.board.isRoughAt(p); }).length; });
check('rubbing out takes squares away', cells2 === 2, `${cells2}`);
await dm.locator('.flyout button', { hasText: 'Clear difficult ground' }).click();
await sleep(400);
check('and it can be cleared', (await dm.evaluate(() => window.__vtt.board.rough.areas.length)) === 0);
await dm.locator('.flyout button', { hasText: 'Elevation' }).first().click();

// Existing stepped terrain from older scenes remains climbable.
await dm.evaluate(async () => {
  const {client}=window.__vtt, g=client.grid;
  for (let i=0;i<5;i++) await client.addDrawing({k:'terrain',hc:true,hg:'step'+i,hz:i*5,
    p:[g.ox+(8.5+i)*g.cell,g.oy+9.5*g.cell].join(','),w:g.cell,color:'#aa8855',fill:0,dash:false,txt:'',fs:28,bw:5});
});
// ---- stairs cost like diagonals
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { rule: 'alt' } }));
await sleep(300);
const stairs = await dm.evaluate(() => { const g = window.__vtt.client.grid; const p = (i) => ({ x: g.ox + (i + 0.5) * g.cell, y: g.oy + 9.5 * g.cell }); return window.__vtt.board.moveCost([p(7), p(12)], false); });
check('four painted rises cost 20 ft of climbing', stairs.note === '25 ft normal + 20 ft climbing' && stairs.ft === 45, JSON.stringify(stairs));
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { rule: 'chebyshev' } }));
await sleep(300);
const st2 = await dm.evaluate(() => { const g = window.__vtt.client.grid; const p = (i) => ({ x: g.ox + (i + 0.5) * g.cell, y: g.oy + 9.5 * g.cell }); return window.__vtt.board.moveCost([p(7), p(12)], false); });
check('the same vertical cost applies on the 5-5-5 rule', st2.note === stairs.note && st2.ft === 45, JSON.stringify(st2));
const gradeAndWall = await dm.evaluate(async ({ from, to, id }) => {
  const { client, board } = window.__vtt;
  await board.chooseGridOverlay('none');
  const mid = { x: (from.x + to.x) / 2, y: from.y };
  const slope = [from, mid, to].map(p => board.groundAtPoint(p));
  const cost = board.moveCost([from, to], false);
  const open = board.moveAllowed(from, to, id);
  const walls = await client.addWalls([{ a: { x: mid.x, y: mid.y - 25 }, b: { x: mid.x, y: mid.y + 25 }, k: 'wall', h: 5, one: 0, open: false, vis: true }]);
  const blocked = !board.moveAllowed(from, to, id);
  await client.updateTokens([id], { fly: true, elev: 20 });
  const fliesOver = board.moveAllowed(from, to, id);
  await client.removeWalls(walls);
  await client.updateTokens([id], { fly: false, elev: 0 });
  await board.chooseGridOverlay('square');
  return { slope, cost, open, blocked, fliesOver };
}, { from: C(8, 9), to: C(9, 9), id: tok });
check('a 5 ft rise keeps a discrete edge and costs 5 ft of climbing', gradeAndWall.slope[0] === 0 && [0,5].includes(gradeAndWall.slope[1]) && gradeAndWall.slope[2] === 5 && gradeAndWall.cost.note === '5 ft normal + 5 ft climbing' && gradeAndWall.cost.ft === 10, JSON.stringify(gradeAndWall));
check('an authored 5 ft wall on the slope is climbable and clears high flyers', gradeAndWall.open && !gradeAndWall.blocked && gradeAndWall.fliesOver, JSON.stringify(gradeAndWall));
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { rule: 'alt' } }));

// ---- cliffs
await dm.evaluate(async (c) => {
  // a 30 ft plateau, 3 x 3 squares, in the open
  const g = window.__vtt.client.grid;
  const pts = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) pts.push(`${g.ox + (i + 16.5) * g.cell},${g.oy + (j + 3.5) * g.cell}`);
  await window.__vtt.client.addDrawing({ k: 'terrain', p: pts.join(','), color: '#aa8855', w: g.cell, fill: 0, fc: '', dash: false, txt: '', fs: 28, bw: 5, hz: 30, hg: 'plateau', ha: false, he: false, hc: true });
}, 0);
await sleep(600);
const nSeg = await dm.evaluate(() => window.__vtt.board.wallSegs().sight.length);
check('the edge of the plateau is a cliff (a wall piece for every square along it)', nSeg >= 12, `${nSeg}`);
const mv = (from, to) => dm.evaluate(([f, t]) => window.__vtt.board.moveAllowed(f, t), [from, to]);
check('the plateau can be climbed', (await mv(C(15, 4), C(16, 4))) === true);
check('including from the side', (await mv(C(17, 2), C(17, 3))) === true);
check('walking off the top is not stopped (it is a fall)', (await mv(C(16, 4), C(15, 4))) === true);
check('walking about on top is fine', (await mv(C(16, 4), C(17, 4))) === true);
await dm.evaluate(() => window.__vtt.client.updateScene({ cliff: 40 }));
await sleep(500);
check('an older saved threshold does not change terrain walls', (await dm.evaluate(() => window.__vtt.board.wallSegs().sight.length)) === nSeg && (await mv(C(15, 4), C(16, 4))) === true);
await dm.evaluate(() => window.__vtt.client.updateScene({ cliff: 10 }));
await sleep(500);
check('and it is back at 10 ft', (await dm.evaluate(() => window.__vtt.board.wallSegs().sight.length)) >= 12 && (await mv(C(15, 4), C(16, 4))));
await dm.keyboard.press('Escape');
await dm.keyboard.press('b');
await dm.getByRole('button', {name:'On this map'}).click();
check('automatic stair threshold is gone', await dm.getByText('Terrain wall threshold', {exact:true}).count() === 0);
await dm.screenshot({path:'/tmp/shots/z3-walls-menu.png'});

// Six staggered, additive round brushes. The entire hill fits between grid centres.
await dm.keyboard.press('Escape');
await dm.keyboard.press('v');
const stack = await dm.evaluate(async id => {
  const { board, client } = window.__vtt;
  await board.chooseGridOverlay('none');
  const g = client.grid, x = g.ox + 12 * g.cell, y = g.oy + 4 * g.cell;
  const base = { x: x - g.cell, y }, top = { x: x + g.cell * 0.12, y };
  for (let i = 0; i < 6; i++) {
    await client.addDrawing({ k: 'terrain', hg: 'brush-cliff-' + i, hz: 5, ha: true,
      p: [x + i * g.cell * 0.04, y].join(','), w: g.cell, color: '#aa8855', fill: 0, fc: '', dash: false, txt: '', fs: 28, bw: 5 });
  }
  await client.updateToken(id, base);
  return { base, top, edge: x - g.cell / 2 };
}, tok);
await dm.waitForFunction(({top}) => window.__vtt.board.groundAtPoint(top) === 30, stack);
await dm.waitForFunction(({id,base}) => {
  const p = window.__vtt.board.views.get(id)?.display;
  return p && Math.hypot(p.x-base.x,p.y-base.y) < 1;
}, {id:tok,base:stack.base});
await dragTo(stack.base, stack.top);
const position = () => dm.evaluate(id => { const { x, y } = window.__vtt.client.scene.tokens.get(id); return { x, y }; }, tok);
check('a walker can reach the summit', near(await position(), stack.top));
const stackCost = await dm.evaluate(({base,top}) => {
  const b = window.__vtt.board;
  return [b.moveCost([base,top],false), b.moveCost([top,base],false)];
}, stack);
check('the stacked brush face charges thirty feet of climbing in both directions',
  stackCost.every(c => c.note.endsWith('30 ft climbing')), JSON.stringify(stackCost));

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
