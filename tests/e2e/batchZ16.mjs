// Round Z16: the scene bar is centred; spell templates have Select; lights go through walls; daylight can be painted; a Player view button; shorter wording.
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
await dm.getByPlaceholder('New table name').fill('Z16');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(600);

const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = grid.cell;
const gx = (i) => grid.ox + i * cell;
const gy = (j) => grid.oy + j * cell;
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const drag = async (a, b) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await dm.mouse.move(q.x, q.y, { steps: 5 });
  await dm.mouse.up();
  await sleep(300);
};
const click = async (a) => { const p = await screen(a[0], a[1]); await dm.mouse.click(p.x, p.y); await sleep(250); };
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
/** the darkness over a spot of the map, 0 (bright) to 1 (black) */
const shadeAt = (wx, wy) => dm.evaluate(([x, y]) => {
  const L = window.__vtt.board.lightLayer;
  const c = L.shade.canvas, sp = L.shade.sprite;
  const px = Math.round((x - sp.position.x) / sp.scale.x), py = Math.round((y - sp.position.y) / sp.scale.y);
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
  return c.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255;
}, [wx, wy]);
const seenAt = (wx, wy) => dm.evaluate(([x, y]) => {
  const L = window.__vtt.board.lightLayer;
  const c = L.seenPaper.canvas, sp = L.seenPaper.sprite;
  const px = Math.round((x - sp.position.x) / sp.scale.x), py = Math.round((y - sp.position.y) / sp.scale.y);
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
  return c.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255;
}, [wx, wy]);
const draws = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()]);
const sel = () => dm.evaluate(() => [...window.__vtt.ui.data.drawSel]);

// ---- #63: the dropdowns in the scene bar sit in the middle of it
const offCentre = () => dm.evaluate(() => {
  const pill = document.querySelector('.pill-left');
  const pr = pill.getBoundingClientRect();
  const mid = (pr.top + pr.bottom) / 2;
  return [...pill.querySelectorAll('select')].map((s) => { const b = s.getBoundingClientRect(); return +Math.abs((b.top + b.bottom) / 2 - mid).toFixed(1); });
});
let off = await offCentre();
check('the scene dropdowns are in the middle of the top bar', off.length >= 1 && off.every((x) => x <= 2), JSON.stringify(off));
await dm.setViewportSize({ width: 1366, height: 768 });
await sleep(400);
off = await offCentre();
check('and still are on a 1366 by 768 screen', off.length >= 1 && off.every((x) => x <= 2), JSON.stringify(off));
await dm.screenshot({ path: '/tmp/shots/z16-bar.png', clip: { x: 0, y: 0, width: 760, height: 90 } });

// ---- #67: a Player view button, between the grid and fog buttons
const order = await dm.evaluate(() => [...document.querySelectorAll('.toolbar .tool')].map((b) => b.getAttribute('aria-label')));
const iGrid = order.findIndex((t) => /the grid$/.test(t || '')), iEye = order.findIndex((t) => /^Player view/.test(t || '')), iFog = order.findIndex((t) => t === 'Fog of war');
check('the toolbar has a Player view button, right between the grid and fog buttons', iGrid >= 0 && iEye === iGrid + 1 && iFog === iEye + 1, JSON.stringify(order));
const bar = await dm.locator('.toolbar').boundingBox();
check('and the toolbar still fits a 768 pixel high screen', !!bar && bar.y + bar.height <= 768, JSON.stringify(bar));
const eye = dm.locator('.toolbar .tool[aria-keyshortcuts="O"]');
check('it shows its key in the tip', /\(O\)/.test((await eye.getAttribute('data-tip')) || ''));
await eye.click();
await sleep(300);
check('clicking it previews what players see', await dm.evaluate(() => window.__vtt.ui.data.dmPreview));
check('and the button shows it is on, and says how to go back', (await eye.getAttribute('class')).includes('on') && (await dm.locator('.toolbar .tool[aria-label="Back to the DM view"]').count()) === 1);
check('the top note says so too', (await dm.locator('.topchip', { hasText: 'Previewing what players see' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z16-eye-on.png' });
await dm.keyboard.press('o');
await sleep(250);
check('the O key switches it off again', !(await dm.evaluate(() => window.__vtt.ui.data.dmPreview)));
await dm.keyboard.press('o');
await sleep(250);
check('and on', await dm.evaluate(() => window.__vtt.ui.data.dmPreview));
await dm.locator('.topchip button', { hasText: 'Stop' }).click();
await sleep(250);
check('Stop in the note still works', !(await dm.evaluate(() => window.__vtt.ui.data.dmPreview)));
await dm.keyboard.press('?');
const keysModal = dm.getByRole('dialog');
await keysModal.waitFor();
check('the key list names the O key', /O\s+player view/.test(await keysModal.innerText()));
await dm.keyboard.press('Escape');
await sleep(300);

// ---- #68: a shorter note on a private scene
await dm.evaluate(async () => { await window.__vtt.client.createScene({ name: 'Second', makeActive: false }); });
await dm.waitForFunction(() => window.__vtt.client.sceneIndex.length === 2);
await dm.evaluate(() => { const c = window.__vtt.client; c.openScene(c.sceneIndex.find((s) => s.name === 'Second').id); });
await sleep(500);
const chipText = (await dm.locator('.corner-chip.warn').innerText()).trim();
check('a private scene says "Hidden from players"', chipText === 'Hidden from players', chipText);
await dm.evaluate(() => { const c = window.__vtt.client; c.openScene(c.sceneIndex.find((s) => s.name !== 'Second').id); });
await sleep(600);
check('and the note goes away on the live scene', (await dm.locator('.corner-chip.warn').count()) === 0);

// ---- #69: "Upload a picture" in the token maker
await dm.keyboard.press('t');
const maker = dm.getByRole('dialog');
await maker.waitFor();
const makerText = await maker.innerText();
check('the token maker says "Upload a picture"', /Upload a picture/.test(makerText) && !/Choose a picture/.test(makerText), makerText.slice(0, 160));
await dm.screenshot({ path: '/tmp/shots/z16-token-maker.png' });
await dm.keyboard.press('Escape');
await sleep(300);

// ---- #65: a light goes through walls, a creature does not
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
const lightId = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Torch', size: 0.5, shape: 'none', label: 'dm', light: { b: 20, d: 20, c: '#ffc27a' } }), [gx(4.5), gy(4.5)]);
const orcId = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Orc', size: 1 }), [gx(4.5), gy(5.5)]);
await dm.evaluate((wx) => window.__vtt.client.addWalls([{ a: { x: wx, y: 0 }, b: { x: wx, y: 2000 }, k: 'wall', open: false, vis: false, one: 0, h: 0 }], 'A long wall'), gx(6));
await sleep(500);
const moveOk = (id, y) => dm.evaluate(([i, from, to]) => window.__vtt.board.moveAllowed(from, to, i), [id, { x: gx(4.5), y }, { x: gx(8.5), y }]);
check('a creature cannot step through a wall', !(await moveOk(orcId, gy(5.5))));
check('a light can', await moveOk(lightId, gy(4.5)));
// really dragged with the mouse
await dm.evaluate((id) => window.__vtt.ui.select([id]), lightId);
await drag([gx(4.5), gy(4.5)], [gx(8.5), gy(4.5)]);
const at = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { x: t.x, y: t.y }; }, lightId);
check('and dragging the light across the wall takes it to the other side', at.x > gx(6), JSON.stringify(at));
await dm.evaluate((id) => window.__vtt.ui.select([id]), orcId);
await drag([gx(4.5), gy(5.5)], [gx(8.5), gy(5.5)]);
const orcAt = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { x: t.x, y: t.y }; }, orcId);
check('the creature is stopped by it', orcAt.x < gx(6), JSON.stringify(orcAt));
await dm.evaluate(([a, b]) => window.__vtt.client.removeTokens([a, b]), [lightId, orcId]);
await dm.evaluate(() => { const c = window.__vtt.client; return c.removeWalls(c.wallsList().map((w) => w.id)); });
await sleep(400);

// ---- #64: spell templates can be picked, moved and deleted one at a time
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'template', tplKind: 'sphere', tplMode: 'place' }));
await sleep(200);
const tpl = async () => (await draws()).filter((d) => d.k === 'sphere');
await drag([gx(12.5), gy(6.5)], [gx(14.5), gy(6.5)]);
await drag([gx(12.5), gy(9.5)], [gx(14.5), gy(9.5)]);
const both = await tpl();
check('two templates placed', both.length === 2, String(both.length));
const [t1, t2] = [...both].sort((a, b) => a.t - b.t);
const x0 = (d) => Number(d.p.split(',')[0]);
const y0 = (d) => Number(d.p.split(',')[1]);
const pick = dm.locator('.flyout .seg button', { hasText: /^Select$/ });
check('the template panel has Place and Select', (await dm.locator('.flyout .seg button', { hasText: /^Place$/ }).count()) === 1 && (await pick.count()) === 1);
await pick.click();
await sleep(200);
check('in Select mode the kinds and colours are out of the way', (await dm.locator('.flyout .seg button', { hasText: /^Sphere$/ }).count()) === 0);
await click([gx(12.5), gy(6.5) + cell * 0.5]);
check('a click picks the template under it', (await sel()).length === 1 && (await sel())[0] === t1.id, JSON.stringify(await sel()));
check('and nothing new was placed', (await tpl()).length === 2);
await dm.screenshot({ path: '/tmp/shots/z16-tpl-selected.png' });
await drag([gx(12.5), gy(6.5)], [gx(15.5), gy(6.5)]);
const moved = (await tpl()).find((d) => d.id === t1.id), still = (await tpl()).find((d) => d.id === t2.id);
check('dragging it moves it three squares', moved && near(x0(moved) - x0(t1), 3 * cell, 3) && near(y0(moved), y0(t1), 3), JSON.stringify({ before: t1.p, after: moved?.p }));
check('and the other one stays where it was', still && still.p === t2.p);
await click([gx(12.5), gy(9.5) + cell * 0.5]);
check('clicking the other one picks that instead', (await sel()).length === 1 && (await sel())[0] === t2.id);
await dm.keyboard.press('Delete');
await sleep(400);
const left = await tpl();
check('Delete takes away just that one', left.length === 1 && left[0].id === t1.id, JSON.stringify(left.map((d) => d.id)));
await dm.keyboard.press('Control+z');
await sleep(500);
check('and Ctrl+Z brings it back', (await tpl()).length === 2);
await click([gx(2.5), gy(2.5)]);
check('a click on empty ground lets go of the pick', (await sel()).length === 0);
await dm.locator('.flyout .seg button', { hasText: /^Place$/ }).click();
await drag([gx(5.5), gy(15.5)], [gx(7.5), gy(15.5)]);
check('Place puts a new template down again', (await tpl()).length === 3);
await dm.getByRole('button', { name: /^Clear/ }).first().click();
await sleep(400);
check('and Clear still takes them all away', (await tpl()).length === 0);

// ---- #66: paint daylight
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'dark' } }));
await sleep(500);
const A = [gx(8.5), gy(8.5)], B = [gx(8.5), gy(15.5)];
check('in the dark, the ground is black to start with', ((await shadeAt(...A)) ?? 0) > 0.8);
await dm.keyboard.press('h');
await dm.locator('.flyout-title', { hasText: /^Heights$/ }).waitFor();
const dayBtn = dm.locator('.flyout .seg button', { hasText: /^Daylight$/ });
check('the Heights panel offers Daylight beside Heights and Difficult', (await dayBtn.count()) === 1 && (await dm.locator('.flyout .seg button', { hasText: /^(Heights|Difficult)$/ }).count()) === 2);
await dayBtn.click();
await sleep(200);
check('with Paint and Erase only', (await dm.locator('.flyout .seg button', { hasText: /^(Paint|Erase)$/ }).count()) === 2 && (await dm.locator('.flyout .seg button', { hasText: /^(Ramp|Select)$/ }).count()) === 0);
check('no height box for it', (await dm.locator('.flyout .ht-card').count()) === 0);
await dm.evaluate(() => window.__vtt.ui.set({ heightSnap: true, heightBrush: 3 }));
await drag([gx(6.5), gy(8.5)], [gx(10.5), gy(8.5)]);
const day = (await draws()).filter((d) => d.dl);
check('one stroke of daylight was made', day.length === 1 && day[0].k === 'terrain', JSON.stringify(day.map((d) => ({ k: d.k, dl: d.dl, hg: d.hg }))));
check('it is not height and not difficult ground', await dm.evaluate(() => window.__vtt.board.zones.areas.length === 0 && window.__vtt.board.rough.areas.length === 0));
check('it is tinted gold while painting', await dm.evaluate(() => window.__vtt.board.dayG.visible && window.__vtt.board.day.areas.length === 1));
await sleep(300);
const lit = await shadeAt(...A);
check('painted ground is no longer dark', lit !== null && lit < 0.05, String(lit));
check('ground beside it still is', ((await shadeAt(...B)) ?? 0) > 0.8 && ((await shadeAt(gx(8.5), gy(11.5))) ?? 0) > 0.8);
await dm.screenshot({ path: '/tmp/shots/z16-daylight.png' });
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
await sleep(200);
check('the gold tint goes when the tool is put down, the daylight stays', await dm.evaluate(() => !window.__vtt.board.dayG.visible) && ((await shadeAt(...A)) ?? 1) < 0.05);

// sight: a token in the dark sees daylight, and nothing else that is unlit
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: true, vision: true, base: 'hidden' } }));
const elf = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Elf', size: 1, sight: 120 }), [gx(13.5), gy(8.5)]);
await sleep(900);
check('a token with sight sees the daylight across the room', ((await seenAt(...A)) ?? 0) > 0.9, String(await seenAt(...A)));
check('and not the dark ground beside it', ((await seenAt(gx(13.5), gy(13.5))) ?? 1) < 0.1 && ((await seenAt(...B)) ?? 1) < 0.1);
await dm.screenshot({ path: '/tmp/shots/z16-daylight-sight.png' });
// a wall in between hides it
await dm.evaluate((wx) => window.__vtt.client.addWalls([{ a: { x: wx, y: 0 }, b: { x: wx, y: 2000 }, k: 'wall', open: false, vis: false, one: 0, h: 0 }], 'Wall'), gx(11.5));
await sleep(700);
check('a wall between them hides the daylight, as it hides everything', ((await seenAt(...A)) ?? 1) < 0.1);
await dm.evaluate(() => { const c = window.__vtt.client; return c.removeWalls(c.wallsList().map((w) => w.id)); });
await sleep(500);
check('and taking the wall away shows it again', ((await seenAt(...A)) ?? 0) > 0.9);
await dm.evaluate((id) => window.__vtt.client.removeTokens([id]), elf);
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: false } }));

// twilight too
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'dim' } }));
await sleep(500);
const dimLit = await shadeAt(...A), dimOut = await shadeAt(...B);
check('in twilight, the daylight is fully bright and the rest is dim', dimLit !== null && dimLit < 0.05 && dimOut > 0.3 && dimOut < 0.6, JSON.stringify({ dimLit, dimOut }));
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'bright' } }));
await sleep(400);
check('in full daylight nothing is painted over the map', await dm.evaluate(() => !window.__vtt.board.lightLayer.container.visible));
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'dark' } }));
await sleep(500);

// erase takes it back, undo puts it back
await dm.keyboard.press('h');
await dm.locator('.flyout .seg button', { hasText: /^Erase$/ }).click();
await drag([gx(7.5), gy(8.5)], [gx(9.5), gy(8.5)]);
await sleep(300);
check('Erase takes daylight away where it passes, and no further', ((await shadeAt(...A)) ?? 0) > 0.8 && ((await shadeAt(gx(5.5), gy(8.5))) ?? 1) < 0.05);
await dm.keyboard.press('Control+z');
await sleep(500);
check('and Ctrl+Z puts it back', ((await shadeAt(...A)) ?? 1) < 0.05);
await dm.locator('.flyout .seg button', { hasText: /^Paint$/ }).click();

// the other buttons leave daylight alone
await dm.locator('.flyout .seg button', { hasText: /^Heights$/ }).click();
await sleep(200);
await drag([gx(15.5), gy(2.5)], [gx(17.5), gy(2.5)]);
check('a height area can be painted next to it', await dm.evaluate(() => window.__vtt.board.zones.areas.length === 1));
await dm.getByRole('button', { name: 'Clear all heights' }).click();
await sleep(400);
check('"Clear all heights" leaves the daylight', (await draws()).filter((d) => d.dl).length === 1 && ((await shadeAt(...A)) ?? 1) < 0.05);
await dayBtn.click();
await sleep(200);
check('and Clear daylight takes only the daylight', (await dm.getByRole('button', { name: 'Clear daylight' }).count()) === 1);
await dm.getByRole('button', { name: 'Clear daylight' }).click();
await sleep(500);
check('it is dark again', (await draws()).filter((d) => d.dl).length === 0 && ((await shadeAt(...A)) ?? 0) > 0.8);
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'bright' } }));
await sleep(300);
check('on a bright scene the panel says what Daylight needs', /Set the scene light to Dim or Dark/.test(await dm.locator('.flyout').innerText()));
await dm.screenshot({ path: '/tmp/shots/z16-day-panel.png' });

const real = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
