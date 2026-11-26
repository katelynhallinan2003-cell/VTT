// Round 5d: the Heights brush. Paint by cell or freely, keep adding to an area, change its height, stack areas, erase, select and move, merge, delete.
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
await dm.getByPlaceholder('New table name').fill('N');
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
const cx = (i) => grid.ox + (i + 0.5) * cell;
const cy = (j) => grid.oy + (j + 0.5) * cell;
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const terrain = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'terrain').map((d) => ({ id: d.id, p: d.p, w: d.w, hz: d.hz ?? null, hg: d.hg || '', ha: !!d.ha, he: !!d.he, hc: !!d.hc })));
const areas = () => dm.evaluate(() => window.__vtt.board.zones.areas.map((a) => ({ id: a.id, h: a.h, add: a.add, legacy: a.legacy, ids: a.ids })));
const sel = () => dm.evaluate(() => [...window.__vtt.ui.data.drawSel]);
const ground = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.groundAtPoint({ x, y }), [wx, wy]);
const drag = async (a, b, opts = {}) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  if (opts.ctrl) await dm.keyboard.down('Control');
  if (opts.alt) await dm.keyboard.down('Alt');
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await dm.mouse.move(q.x, q.y, { steps: 4 });
  if (opts.peek) await opts.peek();
  await dm.mouse.up();
  if (opts.ctrl) await dm.keyboard.up('Control');
  if (opts.alt) await dm.keyboard.up('Alt');
  await sleep(350);
};
const click = async (a, opts = {}) => {
  const p = await screen(a[0], a[1]);
  if (opts.ctrl) await dm.keyboard.down('Control');
  if (opts.shift) await dm.keyboard.down('Shift');
  await dm.mouse.click(p.x, p.y);
  if (opts.ctrl) await dm.keyboard.up('Control');
  if (opts.shift) await dm.keyboard.up('Shift');
  await sleep(300);
};
const pts = (p) => { const n = p.split(',').map(Number); const o = []; for (let i = 0; i + 1 < n.length; i += 2) o.push([n[i], n[i + 1]]); return o; };

// ---- open the tool
await dm.keyboard.press('h');
await dm.locator('.flyout-title', { hasText: /^Elevation$/ }).waitFor();
check('H opens the Heights panel', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'height');
check('it paints by default', (await dm.evaluate(() => window.__vtt.ui.data.heightMode)) === 'paint');
check('there are no Box / Circle buttons any more', (await dm.locator('.flyout .seg button', { hasText: /^(Box|Circle)$/ }).count()) === 0);
check('the panel has Paint, Erase and Select', (await dm.locator('.flyout .seg button', { hasText: /^(Paint|Erase|Select)$/ }).count()) === 3);
await dm.locator('.flyout .chip', { hasText: /^10$/ }).click();
check('the next ground defaults to 10 ft and the card says it is for the next stroke', (await dm.evaluate(() => window.__vtt.ui.data.heightFt)) === 10 && (await dm.locator('.ht-card', { hasText: 'Next ground you paint' }).count()) === 1);

// ---- paint a stroke of whole squares: it shows a height label and a brush while you drag
await drag([cx(10), cy(11)], [cx(13), cy(11)], { peek: async () => {
  check('while dragging, the label shows the height', await dm.evaluate(() => window.__vtt.board.plotLabels.some((l) => l && l.visible && /^10 ft$/.test(l.text))));
} });
let ts = await terrain();
check('one stroke of whole squares is saved', ts.length === 1 && ts[0].hc && ts[0].hz === 10 && !ts[0].he && !!ts[0].hg, JSON.stringify(ts));
const c1 = pts(ts[0].p);
check('it covers the four squares dragged over (10..13) in row 11', c1.length === 4 && c1.every(([x, y]) => Math.abs(y - cy(11)) < 1) && [10, 11, 12, 13].every((i) => c1.some(([x]) => Math.abs(x - cx(i)) < 1)), JSON.stringify(c1));
check('and its width is one square', Math.abs(ts[0].w - cell) < 0.5);
check('that ground is 10 ft high', (await ground(cx(11), cy(11))) === 10);
check('and the square beside it is not', (await ground(cx(14), cy(11))) === 0 && (await ground(cx(11), cy(12))) === 0);
let ar = await areas();
check('one area exists, and it is selected', ar.length === 1 && (await sel()).includes(ts[0].id) && ar[0].h === 10);
check('the card now says Selected ground', (await dm.locator('.ht-card', { hasText: 'Selected ground' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/n1-first-stroke.png' });

// ---- the next stroke joins the selected area instead of starting a new one
await drag([cx(10), cy(12)], [cx(13), cy(12)]);
ts = await terrain();
ar = await areas();
check('a second stroke joins the same area', ts.length === 2 && ts[0].hg === ts[1].hg && ar.length === 1, JSON.stringify(ar.map((a) => a.ids.length)));
check('and both strokes are selected', (await sel()).length === 2);
check('both rows are now 10 ft', (await ground(cx(12), cy(11))) === 10 && (await ground(cx(12), cy(12))) === 10);

// ---- Esc lets go, and the next stroke starts a new area
await dm.keyboard.press('Escape');
check('Esc deselects but keeps the Heights tool', (await sel()).length === 0 && (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'height');
await dm.locator('.flyout .chip', { hasText: /^20$/ }).count();
await dm.locator('.ht-card .numf input').fill('20');
await dm.locator('.ht-card .numf input').blur();
check('with nothing selected the number sets the next ground', (await dm.evaluate(() => window.__vtt.ui.data.heightFt)) === 20);
await drag([cx(12), cy(13)], [cx(15), cy(13)]);
ar = await areas();
check('a stroke after Esc is a new area of 20 ft', ar.length === 2 && ar[1].h === 20, JSON.stringify(ar));
check('the first area did not change', ar[0].h === 10 && (await ground(cx(10), cy(11))) === 10);

// ---- Ctrl-click selects an area and the card edits it
await click([cx(11), cy(11)], { ctrl: true });
ar = await areas();
check('Ctrl-click on the first area selects it', (await sel()).length === 2 && (await sel()).every((id) => ar[0].ids.includes(id)));
check('the card shows its height (10)', (await dm.locator('.ht-card .numf input').inputValue()) === '10');
await dm.locator('.ht-card .numf input').fill('25');
await dm.locator('.ht-card .numf input').blur();
await sleep(350);
ts = await terrain();
check('changing the height changes every stroke of the area', ts.filter((t) => t.hg === ar[0].id).every((t) => t.hz === 25) && (await ground(cx(11), cy(12))) === 25);
check('the other area is untouched', (await ground(cx(13), cy(13))) === 20);

// ---- switching from a selected base to the additive brush leaves the base intact
await dm.locator('.ht-card .seg button', { hasText: 'Added on top' }).click();
await dm.locator('.ht-card .numf input').fill('5');
await dm.locator('.ht-card .numf input').blur();
check('choosing +5 leaves the selected 25 ft base intact', !(await areas())[0].add && await ground(cx(12), cy(12)) === 25);
await drag([cx(12), cy(12)], [cx(12), cy(13)]);
check('a new area that adds 5 makes 25 ft over the 20 ft area', (await ground(cx(12), cy(13))) === 25, String(await ground(cx(12), cy(13))));
check('and 30 ft over the 25 ft area', (await ground(cx(12), cy(12))) === 30, String(await ground(cx(12), cy(12))));
await dm.screenshot({ path: '/tmp/shots/n2-stacked.png' });
await click([cx(12), cy(13)]);
check('a second +5 stroke stacks immediately without New area', await ground(cx(12), cy(13)) === 30 && await ground(cx(12), cy(12)) === 30);
await dm.keyboard.press('Control+z');
await sleep(300);
check('undo removes only the last addition', await ground(cx(12), cy(13)) === 25);

// Select mode can still edit an individual additive brush group.
await dm.locator('.flyout .seg button', { hasText: /^Select$/ }).click();
await click([cx(12), cy(12)]);
await dm.locator('.ht-card .seg button', { hasText: 'Exact height' }).click();
await sleep(300);
check('Sets height: that ground is exactly 5 ft, whatever is under it', (await ground(cx(12), cy(13))) === 5 && (await ground(cx(12), cy(12))) === 5);
await dm.locator('.ht-card .btn', { hasText: /^Delete area/ }).click();
await sleep(400);
check('Delete takes that area away and the ground under it comes back', (await ground(cx(12), cy(13))) === 20 && (await ground(cx(12), cy(12))) === 25);

// ---- erase
await dm.locator('.flyout .seg button', { hasText: /^Erase$/ }).click();
await click([cx(11), cy(11)], { ctrl: true });
ar = await areas();
await drag([cx(11), cy(11)], [cx(11), cy(12)]);
ts = await terrain();
check('rubbing out with an area selected writes an erase stroke tied to it', ts.some((t) => t.he && t.hg === ar[0].id && t.hz === null), JSON.stringify(ts.filter((t) => t.he)));
check('the rubbed squares are open ground again', (await ground(cx(11), cy(11))) === 0 && (await ground(cx(11), cy(12))) === 0);
check('the squares beside them keep their height', (await ground(cx(10), cy(11))) === 25 && (await ground(cx(12), cy(11))) === 25);
check('the area is still selected afterwards', (await sel()).length >= 2);
// erase with nothing selected takes the top ground from every area
await dm.keyboard.press('Escape');
await drag([cx(14), cy(13)], [cx(14), cy(13)]);
check('with nothing selected it rubs out of any area (20 ft area loses that square)', (await ground(cx(14), cy(13))) === 0);
check('erase with nothing selected makes a general erase stroke', (await terrain()).some((t) => t.he && t.hg === ''));

// ---- undo takes the last stroke back
await dm.keyboard.press('Control+z');
await sleep(400);
check('Ctrl+Z brings the rubbed-out square back', (await ground(cx(14), cy(13))) === 20);

// ---- move an area a whole square at a time
await dm.locator('.flyout .seg button', { hasText: /^Select$/ }).click();
const before = (await terrain()).find((t) => t.hg === ar[0].id && !t.he);
await drag([cx(10), cy(11)], [cx(10) + 2.2 * cell, cy(11) - 3.1 * cell]);
const after = (await terrain()).find((t) => t.id === before.id);
const bp = pts(before.p), ap = pts(after.p);
const ddx = ap[0][0] - bp[0][0], ddy = ap[0][1] - bp[0][1];
check('moving it shifts the whole stroke by a whole number of squares', Math.abs(ddx / cell - Math.round(ddx / cell)) < 0.01 && Math.abs(ddy / cell - Math.round(ddy / cell)) < 0.01 && Math.round(ddx / cell) === 2 && Math.round(ddy / cell) === -3, `${ddx / cell}, ${ddy / cell}`);
check('every point moved the same way', ap.every((p, i) => Math.abs(p[0] - bp[i][0] - ddx) < 0.01 && Math.abs(p[1] - bp[i][1] - ddy) < 0.01));
check('the old place is open ground again', (await ground(cx(10), cy(12))) !== 25);
await dm.keyboard.press('Control+z');
await sleep(400);
check('undo moves it back', (await ground(cx(10), cy(12))) === 25);

// ---- Select mode merges whole authored groups, including any detached strokes.
await dm.locator('.flyout .seg button', { hasText: /^Select$/ }).click();
await dm.keyboard.press('Escape');
await dm.locator('.flyout .seg button', { hasText: /^Select$/ }).click();
await click([cx(10), cy(12)]);
await click([cx(14), cy(13)], { shift: true });
ar = await areas();
check('shift-click adds a second area to the selection', (await dm.locator('.ht-card', { hasText: '2 areas selected' }).count()) === 1);
await dm.locator('.ht-card .btn', { hasText: 'Merge' }).click();
await sleep(400);
ar = await areas();
check('Merge makes them one area', ar.length === 1, JSON.stringify(ar.map((a) => [a.h, a.ids.length])));

// ---- delete the area
await dm.locator('.ht-card .btn', { hasText: /^Delete area$/ }).count();
await dm.locator('.flyout .seg button', { hasText: /^Select$/ }).click();
await click([cx(12), cy(12)]);
await dm.locator('.ht-card .btn', { hasText: /^Delete area/ }).click();
await dm.locator('.flyout .seg button', { hasText: /^Paint$/ }).click();
await sleep(400);
check('Delete removes every stroke of the area', (await terrain()).length === 0 && (await areas()).length === 0);

// ---- a free brush
await dm.evaluate(() => window.__vtt.ui.set({ heightSnap: false, heightBrush: 2, heightFt: 15 }));
await sleep(150);
await drag([cx(10), cy(11)], [cx(13) + 20, cy(12)]);
ts = await terrain();
check('free brush: one stroke, not made of squares, 2 squares wide', ts.length === 1 && !ts[0].hc && Math.abs(ts[0].w - 2 * cell) < 0.5, JSON.stringify(ts));
check('its path was smoothed to a few points', pts(ts[0].p).length >= 2 && pts(ts[0].p).length < 40);
check('the ground under it is 15 ft, and off to the side it is not', (await ground(cx(11), cy(11) + 20)) === 15 && (await ground(cx(11), cy(15))) === 0);
// Alt flips snapping for one stroke
await dm.keyboard.press('Escape');
await dm.evaluate(() => window.__vtt.ui.set({ heightBrush: 1 }));
await drag([cx(10), cy(14)], [cx(12), cy(14)], { alt: true });
ts = await terrain();
check('Alt flips the brush for one stroke (free became squares)', ts.length === 2 && ts[1].hc === true, JSON.stringify(ts[1]));
await dm.evaluate(() => window.__vtt.ui.set({ heightSnap: true }));

// ---- leaving the tool, and the select tool
check('an area is selected now', (await sel()).length > 0);
await dm.keyboard.press('Escape');
check('first Esc only lets go', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'height');
await dm.keyboard.press('Escape');
check('second Esc leaves the tool', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'select');
await dm.keyboard.press('h');
await click([cx(11), cy(11)], { ctrl: true });
check('ground is selected in the Heights tool', (await sel()).length > 0);
await dm.keyboard.press('v');
await sleep(200);
check('switching tools lets go of it', (await sel()).length === 0);
await dm.evaluate(() => window.__vtt.ui.set({ heightView: 'always' }));
await click([cx(11), cy(11)]);
check('the select tool does not grab painted ground', (await sel()).length === 0);
check('the select tool has no inspector for it', (await dm.locator('.drawtag').count()) === 0);

// ---- tokens stand on it
const gob = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Goblin' }), [cx(11), cy(11)]);
await sleep(500);
const alt = await dm.evaluate((i) => window.__vtt.board.heightOf(window.__vtt.client.scene.tokens.get(i)).alt, gob);
check('a token on the brush ground stands at its height', alt === 15, String(alt));

// ---- old boxes and circles are still ground
await dm.evaluate(([x0, y0, x1, y1]) => window.__vtt.client.addDrawing({ k: 'rect', p: `${x0},${y0},${x1},${y1}`, color: '#a8b0ba', w: 2, fill: 0.4, fc: '#a8b0ba', dash: false, txt: '', fs: 28, bw: 5, hz: 40 }), [cx(10), cy(3), cx(12), cy(5)]);
await sleep(500);
check('an old-style box with a height still counts', (await ground(cx(11), cy(4))) === 40);
await dm.keyboard.press('h');
await click([cx(11), cy(4)], { ctrl: true });
ar = await areas();
check('and can be selected, with its height in the card', (await dm.locator('.ht-card .numf input').inputValue()) === '40');
await dm.locator('.ht-card .numf input').fill('30');
await dm.locator('.ht-card .numf input').blur();
await sleep(350);
check('its height can be changed', (await ground(cx(11), cy(4))) === 30);
check('a new additive stroke can be started above an old box', await dm.locator('.ht-card .seg button', { hasText: 'Added on top' }).isEnabled());
await dm.screenshot({ path: '/tmp/shots/n3-final.png' });

// ---- clear all
await dm.locator('.flyout .btn', { hasText: 'Clear all heights' }).click();
await sleep(500);
check('Clear all heights removes brush and box ground', (await areas()).length === 0 && (await terrain()).length === 0);

// A gridless scene always uses a round brush, including after a gridded ramp or with Alt held.
await dm.evaluate(async () => {
  const { board, ui } = window.__vtt;
  ui.set({ heightMode: 'paint', heightSnap: true, heightFt: 15, heightAdds: false, heightBrush: 6 });
  await board.chooseGridOverlay('none');
});
await dm.getByText('Brush diameter (ft)', { exact: true }).waitFor();
check('gridless has a calibrated brush and no cell-fill or ramp controls', await dm.locator('.flyout .chips button.on').first().innerText() === String(6 * grid.ft) && await dm.getByText(/^Fill whole/).count() === 0 && await dm.locator('.flyout button', { hasText: /^Ramp$/ }).count() === 0);
const gx = cx(12) + cell * 0.28, gy = cy(11) + cell * 0.23;
await drag([gx, gy], [gx, gy], { alt: true });
ts = await terrain();
check('wide gridless dab is centred at the pointer and keeps its full diameter', ts.length === 1 && !ts[0].hc && Math.abs(ts[0].w - cell * 6) < 0.5 && Math.abs(pts(ts[0].p)[0][0] - gx) < 2);
check('gridless brush has a round edge', await ground(gx + cell * 2.8, gy) === 15 && await ground(gx + 2.3 * cell, gy + 2.3 * cell) === 0);
await dm.getByRole('button', { name: 'Added on top', exact: true }).click();
await dm.locator('.ht-card .numf input').fill('-10');
await dm.locator('.ht-card .numf input').blur();
await click([gx, gy]);
await click([gx, gy]);
check('two gridless lowering strokes can dig below zero', await ground(gx, gy) === -5);
await dm.getByRole('button', { name: 'Erase', exact: true }).click();
await dm.locator('.flyout .chips').first().getByRole('button', { name: String(grid.ft), exact: true }).click();
await drag([gx, gy], [gx + cell * 0.7, gy]);
check('gridless erasing follows the brush and leaves nearby ground intact', await ground(gx, gy) === 0 && await ground(gx, gy + cell) === -5 && !(await terrain()).at(-1).hc);
await dm.getByRole('button', { name: 'Diff Terrain', exact: true }).click();
await dm.getByRole('button', { name: 'Paint', exact: true }).click();
await drag([gx, gy], [gx + cell, gy], { alt: true });
const difficult = await dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter(d => d.dt));
check('difficult ground uses a freehand path and preserves elevation', difficult.length === 1 && !difficult[0].hc && pts(difficult[0].p).length >= 2 && await ground(gx, gy) === 0);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
