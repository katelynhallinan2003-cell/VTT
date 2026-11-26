// Drawing, shapes, spell templates, ruler, test move and auras, with a second browser tab as a player.
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
await dm.getByPlaceholder('New table name').fill('B2');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.getByRole('button', { name: 'Create scene' }).waitFor();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

// a player joins in a second tab
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

const toScreen = (page, wx, wy) => page.evaluate(([x, y]) => {
  const b = window.__vtt.board;
  const r = b.app.canvas.getBoundingClientRect();
  return { x: r.left + b.cam.tx + x * b.cam.zoom, y: r.top + b.cam.ty + y * b.cam.zoom };
}, [wx, wy]);
const draws = (page) => page.evaluate(() => [...window.__vtt.client.scene.draws.values()].map((d) => ({ id: d.id, k: d.k, p: d.p, uid: d.uid, color: d.color, w: d.w, fill: d.fill, dash: d.dash, txt: d.txt })));
const drag = async (page, a, b, steps = 8, mods = []) => {
  const A = await toScreen(page, a.x, a.y);
  const B = await toScreen(page, b.x, b.y);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(A.x, A.y);
  await page.mouse.down();
  await page.mouse.move(B.x, B.y, { steps });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await sleep(150);
};
const cell = await dm.evaluate(() => window.__vtt.client.grid.cell);
const X0 = 7 * cell; // keeps test strokes clear of the tool panel on the left (and on the grid)
const rel = (page, a, b, steps, mods) => drag(page, { x: a.x + X0, y: a.y }, { x: b.x + X0, y: b.y }, steps, mods);

// ---- draw tools
await dm.keyboard.press('p');
check('D opens the draw flyout', (await dm.locator('.flyout-title', { hasText: 'Draw' }).count()) === 1);
await rel(dm, { x: 300, y: 300 }, { x: 520, y: 380 }, 14);
let list = await draws(dm);
check('pen stroke is saved', list.length === 1 && list[0].k === 'pen' && list[0].p.split(',').length >= 4, JSON.stringify(list[0]?.p).slice(0, 60));
check('pen stroke is simplified, not one point per mouse event', list[0].p.split(',').length <= 14 * 2 + 2);
await dm.waitForTimeout(200);
check('player sees the drawing', (await draws(pl)).length === 1);

const pick = async (name) => { await dm.locator('.flyout .seg button', { hasText: name }).first().click(); };
await pick('Line');
await rel(dm, { x: 300, y: 450 }, { x: 600, y: 450 });
await pick('Arrow');
await rel(dm, { x: 300, y: 500 }, { x: 600, y: 560 });
await pick('Box');
await dm.locator('.flyout .seg button', { hasText: 'See-through' }).click();
await rel(dm, { x: 650, y: 300 }, { x: 800, y: 420 });
await pick('Circle');
await rel(dm, { x: 650, y: 450 }, { x: 800, y: 560 });
list = await draws(dm);
check('line, arrow, box and circle saved', ['line', 'arrow', 'rect', 'ellipse'].every((k) => list.some((d) => d.k === k)), list.map((d) => d.k).join(','));
check('fill toggle applies to the box', list.find((d) => d.k === 'rect')?.fill > 0);
await dm.screenshot({ path: '/tmp/shots/60-drawings.png' });

// text
await pick('Text');
const tpos = await toScreen(dm, 330 + X0, 640);
await dm.mouse.click(tpos.x, tpos.y);
await dm.waitForSelector('.text-editor');
await dm.waitForFunction(() => document.activeElement?.classList.contains('text-editor'));
await dm.keyboard.type('Trap here');
await dm.keyboard.press('Enter');
await sleep(250);
list = await draws(dm);
check('text is saved', list.some((d) => d.k === 'text' && d.txt === 'Trap here'));

// undo / redo
const n0 = list.length;
await dm.keyboard.press('Escape');
await dm.keyboard.press('Control+z');
await sleep(250);
check('Ctrl+Z removes the last drawing', (await draws(dm)).length === n0 - 1);
await dm.keyboard.press('Control+y');
await sleep(250);
check('Ctrl+Y brings it back', (await draws(dm)).length === n0);

// player draws too, and cannot erase the DM's drawing
await pl.keyboard.press('p');
await pl.locator('.flyout .seg button', { hasText: 'Line' }).first().click();
await rel(pl, { x: 900, y: 300 }, { x: 1000, y: 360 });
await sleep(300);
const afterPl = await draws(dm);
const plDraw = afterPl.find((d) => d.uid !== afterPl[0].uid);
check('player drawing reaches the DM', !!plDraw);
await pl.locator('.flyout .seg button', { hasText: 'Erase' }).first().click();
await rel(pl, { x: 300, y: 450 }, { x: 600, y: 450 }); // across the DM's line
await sleep(300);
check("a player cannot erase the DM's drawing", (await draws(dm)).some((d) => d.k === 'line' && d.p.startsWith(`${300 + X0},450`)));
await rel(pl, { x: 880, y: 300 }, { x: 1020, y: 370 }); // across their own line
await sleep(300);
check('a player can erase their own', !(await draws(dm)).some((d) => d.uid === plDraw.uid));
await pl.keyboard.press('Escape');

// eraser (DM) and select / move / delete
await dm.keyboard.press('p');
await pick('Erase');
await rel(dm, { x: 300, y: 450 }, { x: 600, y: 450 });
check('eraser removes what it crosses', !(await draws(dm)).some((d) => d.k === 'line'));
await dm.keyboard.press('Escape');
const before = (await draws(dm)).find((d) => d.k === 'ellipse');
const ep = before.p.split(',').map(Number); // x1,y1,x2,y2
await dm.keyboard.press('v');
const edge = { x: ep[2], y: (ep[1] + ep[3]) / 2 }; // right edge of the circle
await drag(dm, edge, { x: edge.x + 120, y: edge.y + 40 }, 6);
const afterMove = (await draws(dm)).find((d) => d.id === before.id);
check('dragging a drawing moves it', afterMove && Math.abs(Number(afterMove.p.split(',')[0]) - ep[0] - 120) < 2, afterMove?.p);
await dm.keyboard.press('Control+z');
await sleep(250);
check('and the move can be undone', (await draws(dm)).find((d) => d.id === before.id)?.p === before.p);
await dm.keyboard.press('Delete');
await sleep(250);
check('Delete removes the selected drawing', !(await draws(dm)).some((d) => d.id === before.id));
await dm.keyboard.press('Control+z');
await sleep(200);

// clear mine (DM clear all)
await dm.keyboard.press('p');
await dm.locator('.flyout button', { hasText: 'Clear all' }).click();
await sleep(300);
check('Clear all removes every drawing', (await draws(dm)).length === 0);
await dm.keyboard.press('Control+z');
await sleep(300);
check('and Ctrl+Z restores them', (await draws(dm)).length > 3);
await dm.locator('.flyout button', { hasText: 'Clear all' }).click();
await sleep(300);
await dm.keyboard.press('Escape');

// ---- spell templates
await dm.keyboard.press('c');
check('S opens the template flyout', (await dm.locator('.flyout-title', { hasText: 'Spell templates' }).count()) === 1);
const origin = { x: 5 * cell, y: 5 * cell };
await dm.locator('.flyout .seg button', { hasText: 'Cone' }).click();
await rel(dm, origin, { x: origin.x + 3.2 * cell, y: origin.y + 0.2 * cell }, 8);
let t = (await draws(dm)).find((d) => d.k === 'cone');
const tp = t.p.split(',').map(Number);
const tl = Math.hypot(tp[2] - tp[0], tp[3] - tp[1]);
check('a cone snaps to whole squares (15 ft)', !!t && Math.abs(tl - 3 * cell) < 1.5, `${Math.round(tl)}px = ${(tl / cell) * 5}ft`);
{ const u = tp[0] / cell, v = tp[1] / cell, fr = (n) => Math.abs(n - Math.floor(n) - 0.5) < 0.05, ln = (n) => Math.abs(n - Math.round(n)) < 0.05;
  check('and its start sits in the middle of a grid line (2024 rules)', (ln(u) && fr(v)) || (ln(v) && fr(u)), `${u.toFixed(2)},${v.toFixed(2)}`); }
await dm.locator('.flyout .seg button', { hasText: 'Sphere' }).click();
await rel(dm, { x: 8 * cell, y: 6 * cell }, { x: 12.45 * cell, y: 6.5 * cell }, 8);
check('a sphere of 20 ft radius', (await draws(dm)).some((d) => d.k === 'sphere' && Math.abs(Math.hypot(...[d.p.split(',').map(Number)].map((q) => [q[2] - q[0], q[3] - q[1]])[0]) - 4 * cell) < 2));
await dm.locator('.flyout .seg button', { hasText: 'Cube' }).click();
await rel(dm, { x: 4 * cell, y: 9 * cell }, { x: 4 * cell, y: 11 * cell }, 8);
await dm.locator('.flyout .seg button', { hasText: 'Line' }).click();
await rel(dm, { x: 8 * cell, y: 9 * cell }, { x: 14 * cell, y: 9 * cell }, 8);
const kinds = (await draws(dm)).map((d) => d.k);
check('cube and line templates saved', kinds.includes('cube') && kinds.includes('beam'), kinds.join(','));
await dm.screenshot({ path: '/tmp/shots/61-templates.png' });
await sleep(200);
check('players see the templates', (await draws(pl)).filter((d) => ['cone', 'sphere', 'cube', 'beam'].includes(d.k)).length === 4);
await dm.locator('.flyout button', { hasText: 'Clear all templates' }).click();
await sleep(300);
check('Clear templates works', (await draws(dm)).length === 0);
await dm.keyboard.press('Escape');

// ---- ruler
await dm.keyboard.press('r');
check('R opens the ruler flyout', (await dm.locator('.flyout-title', { hasText: 'Ruler' }).count()) === 1);
await rel(dm, { x: 2.5 * cell, y: 2.5 * cell }, { x: 8.5 * cell, y: 4.5 * cell }, 8);
const ruler = await dm.evaluate(() => window.__vtt.board.ruler);
check('ruler measures from square to square', ruler && Math.abs(ruler.b.x - ruler.a.x - 6 * cell) < 1 && Math.abs(ruler.b.y - ruler.a.y - 2 * cell) < 1);
check('ruler is private by default', (await pl.evaluate(() => [...window.__vtt.client.scene.live.values()].filter((l) => l.ruler).length)) === 0);
await dm.screenshot({ path: '/tmp/shots/62-ruler.png' });
await dm.locator('.flyout .toggle', { hasText: 'Show my ruler to everyone' }).click();
await sleep(500);
check('sharing the ruler shows it to players', (await pl.evaluate(() => [...window.__vtt.client.scene.live.values()].filter((l) => l.ruler).length)) === 1);
await pl.screenshot({ path: '/tmp/shots/63-player-sees-ruler.png' });
await dm.locator('.flyout .toggle', { hasText: 'Show my ruler to everyone' }).click();
await sleep(500);
check('and turning it off hides it again', (await pl.evaluate(() => [...window.__vtt.client.scene.live.values()].filter((l) => l.ruler).length)) === 0);
await dm.keyboard.press('Escape');
await sleep(150);
check('Esc clears the ruler', (await dm.evaluate(() => window.__vtt.board.ruler)) === null);

// ---- test move
const tok = await dm.evaluate(() => window.__vtt.client.addToken({ x: 3.5 * 70, y: 12.5 * 70, name: 'Fighter', size: 1 }));
await sleep(400);
const tokPos = async () => dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); const v = window.__vtt.board.views.get(id); return { x: t.x, y: t.y, dx: v.display.x, dy: v.display.y }; }, tok);
const p0 = await tokPos();
await dm.keyboard.press('m');
check('M turns on test move', (await dm.locator('.testbar').count()) === 1);
await drag(dm, { x: p0.x, y: p0.y }, { x: p0.x + 5 * cell, y: p0.y }, 8);
const p1 = await tokPos();
check('the token shows at the test spot but has not really moved', Math.abs(p1.dx - (p0.x + 5 * cell)) < 2 && p1.x === p0.x, `real ${p1.x}, shown ${Math.round(p1.dx)}`);
await dm.waitForFunction(() => window.__vtt.board.ghostViews.size === 1);
check('a shadow stays where it was', (await dm.evaluate(() => window.__vtt.board.ghostViews.size)) === 1);
check('the bar counts it', (await dm.locator('.testbar', { hasText: '1 moved' }).count()) === 1);
check('other players see nothing by default', (await pl.evaluate(() => [...window.__vtt.client.scene.live.values()].filter((l) => Object.keys(l.ghosts).length).length)) === 0);
await dm.screenshot({ path: '/tmp/shots/64-test-move.png' });
await dm.locator('.testbar label', { hasText: 'Show others' }).click();
await sleep(500);
check('turning on "show others" sends the ghost', (await pl.evaluate(() => [...window.__vtt.client.scene.live.values()].filter((l) => Object.keys(l.ghosts).length).length)) === 1);
check('the player draws a ghost of it', (await pl.evaluate(() => window.__vtt.board.ghostViews.size)) === 1);
await pl.screenshot({ path: '/tmp/shots/65-player-sees-ghost.png' });
await dm.locator('.testbar button', { hasText: 'Reset' }).click();
await dm.waitForFunction(({id,x}) => Math.abs(window.__vtt.board.views.get(id).display.x-x) < 2, {id:tok,x:p0.x});
await pl.waitForFunction(() => window.__vtt.board.ghostViews.size === 0);
const p2 = await tokPos();
check('Reset puts the token back', Math.abs(p2.dx - p0.x) < 2 && p2.x === p0.x);
check('and the player no longer sees a ghost', (await pl.evaluate(() => window.__vtt.board.ghostViews.size)) === 0);
await drag(dm, { x: p0.x, y: p0.y }, { x: p0.x, y: p0.y - 3 * cell }, 8);
await dm.locator('.testbar button', { hasText: 'Keep' }).click();
await sleep(400);
const p3 = await tokPos();
check('Keep makes the move real', Math.abs(p3.y - (p0.y - 3 * cell)) < 2, `${p3.y}`);
await dm.keyboard.press('m');
await dm.keyboard.press('Control+z');
await sleep(400);
check('and it can be undone', Math.abs((await tokPos()).y - p0.y) < 2);

// ---- auras
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { auras: [{ r: 15, color: '#2f9e44', a: 0.25, shape: 'circle', edge: true, dm: false }, { r: 30, color: '#1c7ed6', a: 0.12, shape: 'square', edge: false, dm: true }] }), tok);
await sleep(400);
await dm.evaluate((id) => window.__vtt.board.centerOn({ x: window.__vtt.client.scene.tokens.get(id).x, y: window.__vtt.client.scene.tokens.get(id).y }), tok);
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/66-auras-dm.png' });
await pl.evaluate((id) => window.__vtt.board.centerOn({ x: window.__vtt.client.scene.tokens.get(id).x, y: window.__vtt.client.scene.tokens.get(id).y }), tok);
await sleep(300);
await pl.screenshot({ path: '/tmp/shots/67-auras-player.png' });
check('auras reach the player (both stored, DM-only one hidden by the view)', (await pl.evaluate((id) => window.__vtt.client.scene.tokens.get(id).auras.length, tok)) === 2);

// the aura editor
await dm.evaluate((id) => window.__vtt.ui.select([id]), tok);
await sleep(200);
await dm.locator('.tokentag button', { hasText: /Edit/ }).click();
await dm.waitForSelector('.auras');
check('token editor lists both auras', (await dm.locator('.aura-row').count()) === 2);
await dm.locator('.auras button', { hasText: '+ Add aura' }).click();
check('and can add one', (await dm.locator('.aura-row').count()) === 3);
await dm.locator('.aura-row').nth(2).locator('button', { hasText: '✕' }).click();
await dm.locator('.aura-row').nth(0).locator('.aura-r').fill('20');
await dm.screenshot({ path: '/tmp/shots/68-aura-editor.png' });
await dm.locator('.modal-foot .btn.primary').click();
await sleep(500);
check('saving keeps the edited radius', (await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id).auras[0].r, tok)) === 20);

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
