// Round 6e: light and darkness. Scene brightness, placed lights, carried torches, darkvision, walls stopping light, and what tokens see in the dark.
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
await dm.getByPlaceholder('New table name').fill('U');
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
const meta = () => dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { light: { ...m.light }, fog: { ...m.fog } }; });
/** the darkness over a spot of the map, 0 (bright) to 1 (black), read from the canvas the dark is painted on */
const shadeAt = (wx, wy) => dm.evaluate(([x, y]) => {
  const L = window.__vtt.board.lightLayer;
  const c = L.shade.canvas;
  const sp = L.shade.sprite;
  const px = Math.round((x - sp.position.x) * sp.scale.x ** -1), py = Math.round((y - sp.position.y) * sp.scale.y ** -1);
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
  return c.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255;
}, [wx, wy]);
const seenAt = (wx, wy) => dm.evaluate(([x, y]) => {
  const L = window.__vtt.board.lightLayer;
  const c = L.seenPaper.canvas;
  const sp = L.seenPaper.sprite;
  const px = Math.round((x - sp.position.x) / sp.scale.x), py = Math.round((y - sp.position.y) / sp.scale.y);
  if (px < 0 || py < 0 || px >= c.width || py >= c.height) return null;
  return c.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255;
}, [wx, wy]);
const lightVisible = () => dm.evaluate(() => window.__vtt.board.lightLayer.container.visible);
const maskKind = () => dm.evaluate(() => window.__vtt.board.fogMaskKind);

// ---- daylight leaves everything alone
check('a new scene is in daylight', (await meta()).light.ambient === 'bright');
check('and nothing is painted over the map', (await lightVisible()) === false);

// ---- the Scene panel
await dm.locator('.dock-tabs button, .tabs button', { hasText: /^Scene$/ }).first().click().catch(() => {});
const darkBtn = dm.getByRole('button', { name: 'Dark', exact: true });
if (!(await darkBtn.isVisible().catch(() => false))) await dm.locator('.sect-head', { hasText: 'Light and darkness' }).click();
await darkBtn.waitFor();
check('the panel offers Daylight, Twilight and Dark', (await dm.locator('.seg button', { hasText: /^(Daylight|Twilight|Dark)$/ }).count()) === 3);
await dm.getByRole('button', { name: 'Dark', exact: true }).click();
await sleep(400);
check('picking Dark saves it', (await meta()).light.ambient === 'dark');
check('and the dark is painted over the map', (await lightVisible()) === true);
const cx = gx(8), cy = gy(8);
const dark0 = await shadeAt(cx, cy);
check('with no light the ground is nearly black', dark0 !== null && dark0 > 0.8, String(dark0));
await dm.screenshot({ path: '/tmp/shots/u1-dark.png' });

// ---- a light placed from the panel
await dm.getByRole('button', { name: 'Place a light' }).click();
await sleep(500);
const lights = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].filter((t) => t.light).map((t) => ({ id: t.id, x: t.x, y: t.y, shape: t.shape, light: t.light, name: t.name, label: t.label })));
check('Place a light adds one marker, shaped as nothing, with the torch it says', lights.length === 1 && lights[0].shape === 'none' && lights[0].light.b === 20 && lights[0].light.d === 20, JSON.stringify(lights));
const L1 = lights[0];
await sleep(300);
const lit = await shadeAt(L1.x, L1.y);
check('the ground at the light is bright', lit !== null && lit < 0.1, String(lit));
const dimSpot = await shadeAt(L1.x + 6 * cell, L1.y);
check('six squares away (dim part of a 20 + 20 torch) it is about half dark', dimSpot !== null && dimSpot > 0.3 && dimSpot < 0.6, String(dimSpot));
const far = await shadeAt(L1.x + 10 * cell, L1.y);
check('ten squares away it is dark again', far !== null && far > 0.8, String(far));
await dm.screenshot({ path: '/tmp/shots/u2-torch.png' });

// ---- the light can be moved and changed
const X0 = gx(9) + cell / 2;
await dm.evaluate((p) => window.__vtt.client.updateToken(p.id, { x: p.x, light: { b: 40, d: 0, c: '#ff0000' } }), { id: L1.id, x: X0 });
await sleep(600);
check('moving it moves the bright spot', ((await shadeAt(X0, L1.y)) ?? 1) < 0.1 && ((await shadeAt(X0 - 9 * cell, L1.y)) ?? 0) > 0.8);
check('a 40 ft light reaches eight squares', ((await shadeAt(X0 + 6 * cell, L1.y)) ?? 1) < 0.2);

// ---- a wall stops light
await dm.evaluate((a) => window.__vtt.client.addWalls([{ a: { x: a.x, y: a.y1 }, b: { x: a.x, y: a.y2 }, k: 'wall', open: false, vis: false, one: 0, h: 0 }]), { x: X0 + 2 * cell, y1: L1.y - 6 * cell, y2: L1.y + 6 * cell });
await sleep(600);
const beyond = await shadeAt(X0 + 4 * cell, L1.y);
check('behind a wall the light does not reach', beyond !== null && beyond > 0.8, String(beyond));
check('in front of it the light still does', ((await shadeAt(X0 + 1 * cell, L1.y)) ?? 1) < 0.2);
await dm.screenshot({ path: '/tmp/shots/u3-wall.png' });

// ---- tokens only see what is lit
await dm.evaluate(() => { const c = window.__vtt.client; return c.removeWalls([...c.scene.walls.keys()]); });
await sleep(300);
const X = X0, Y = L1.y; // where the light now is
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: true, vision: true, base: 'hidden' } }));
const elf = await dm.evaluate(async ([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Elf', size: 1, sight: 120 }), [X + 12 * cell, Y]);
await sleep(800);
check('in the dark with fog and sight on, the fog is cut open in the lit shape', (await maskKind()) === 's');
check('the token itself is seen (it makes out what is beside it)', ((await seenAt(X + 12 * cell, Y)) ?? 0) > 0.9);
check('the light twelve squares away is seen, since it is lit and within sight', ((await seenAt(X, Y)) ?? 0) > 0.9);
check('dark ground within its sight is not seen', ((await seenAt(X + 17 * cell, Y)) ?? 1) < 0.1 && ((await seenAt(X + 12 * cell, Y + 6 * cell)) ?? 1) < 0.1);
await dm.screenshot({ path: '/tmp/shots/u4-gated.png' });
// darkvision
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { dv: 30 }), elf);
await sleep(600);
check('with 30 ft of darkvision it sees five squares into the dark', ((await seenAt(X + 12 * cell + 5 * cell, Y)) ?? 0) > 0.9);
check('but not eight', ((await seenAt(X + 12 * cell + 8 * cell, Y)) ?? 1) < 0.1);
check('darkvision also lifts the dark on the map (dim, not bright)', (() => true)());
const dvShade = await shadeAt(X + 12 * cell + 4 * cell, Y);
check('the map there is about half dark, as if dim', dvShade !== null && dvShade > 0.3 && dvShade < 0.6, String(dvShade));
await dm.screenshot({ path: '/tmp/shots/u5-darkvision.png' });
// a wall between them hides the light
await dm.evaluate((a) => window.__vtt.client.addWalls([{ a: { x: a.x, y: a.y - 8 * a.c }, b: { x: a.x, y: a.y + 8 * a.c }, k: 'wall', open: false, vis: false, one: 0, h: 0 }]), { x: X + 6 * cell, y: Y, c: cell });
await sleep(600);
check('a wall between the token and the light hides the lit ground', ((await seenAt(X, Y)) ?? 1) < 0.1);
check('what is beside the token on its own side is still seen', ((await seenAt(X + 12 * cell + 3 * cell, Y)) ?? 0) > 0.9);
await dm.screenshot({ path: '/tmp/shots/u6-wall-gate.png' });

// ---- the player sees the same
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(1200);
const plKind = await pl.evaluate(() => window.__vtt.board.fogMaskKind);
check('a player gets the dark and the same fog shape', plKind === 's' && (await pl.evaluate(() => window.__vtt.board.lightLayer.container.visible)) === true);
const plShade = await pl.evaluate(([x, y]) => { const L = window.__vtt.board.lightLayer; const sp = L.shade.sprite; const c = L.shade.canvas; return c.getContext('2d').getImageData(Math.round((x - sp.position.x) / sp.scale.x), Math.round((y - sp.position.y) / sp.scale.y), 1, 1).data[3] / 255; }, [X, Y]);
check('and the dark is as heavy for them as for the DM would be at full strength (the DM sees through it)', plShade < 0.1 && (await pl.evaluate(() => window.__vtt.board.lightLayer.shade.sprite.alpha)) === 1 && (await dm.evaluate(() => window.__vtt.board.lightLayer.shade.sprite.alpha)) < 1);
await pl.screenshot({ path: '/tmp/shots/u7-player.png' });
await dm.bringToFront();

// ---- what is remembered in the dark
await dm.evaluate(() => { const c = window.__vtt.client; return c.removeWalls([...c.scene.walls.keys()]); });
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { dv: 0 }), elf);
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: true, vision: true, explore: true, base: 'hidden' } }));
await sleep(500);
const fogAt = (wx, wy) => dm.evaluate(([x, y]) => {
  const m = window.__vtt.board.fogMask;
  const px = Math.round((x - m.origin.x) * m.scale), py = Math.round((y - m.origin.y) * m.scale);
  if (px < 0 || py < 0 || px >= m.canvas.width || py >= m.canvas.height) return null;
  return m.canvas.getContext('2d').getImageData(px, py, 1, 1).data[3] / 255;
}, [wx, wy]);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(300);
check('a token that stands in the dark with the light in sight remembers the lit ground at once', ((await fogAt(X, Y)) ?? 1) < 0.1);
await dm.evaluate(([id, x, y]) => window.__vtt.client.updateToken(id, { x, y }), [elf, X + 10 * cell, Y]);
await sleep(700);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(500);
check('the lit ground it could see is now remembered', ((await fogAt(X, Y)) ?? 1) < 0.1);
check('dark ground beside it, within its sight, is not', ((await fogAt(X + 10 * cell + 5 * cell, Y)) ?? 0) > 0.9 && ((await fogAt(X + 10 * cell, Y + 6 * cell)) ?? 0) > 0.9);
await dm.evaluate(([id, x, y]) => window.__vtt.client.updateToken(id, { x, y }), [elf, X + 18 * cell, Y]);
await sleep(700);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(400);
check('and it stays remembered after the token has gone on', ((await fogAt(X, Y)) ?? 1) < 0.1);
// a token carrying a torch remembers what its own light reached, not its whole sight
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { light: { b: 20, d: 20, c: '#ffc27a' }, y: window.__vtt.client.scene.tokens.get(id).y }), elf);
await sleep(400);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await dm.evaluate(([id, x, y]) => window.__vtt.client.updateToken(id, { x, y }), [elf, X + 18 * cell, Y + 6 * cell]);
await sleep(700);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(400);
check('with a torch of its own it remembers the ground its light reached on the way', ((await fogAt(X + 18 * cell, Y + 3 * cell)) ?? 1) < 0.1);
check('but not ground far beyond its light, though it was within its sight', ((await fogAt(X + 18 * cell, Y + 6 * cell - 11 * cell)) ?? 0) > 0.9);
await dm.screenshot({ path: '/tmp/shots/u9-explored.png' });

// ---- the token editor: darkvision and a light of its own
await dm.evaluate((id) => window.__vtt.ui.select([id]), elf);
await sleep(300);
await dm.locator('.tagbar button, .sel-tag button, .flyout button, button', { hasText: /^Edit$/ }).first().click();
await dm.locator('.modal h4', { hasText: 'Darkness and light' }).waitFor();
check('the token editor has a Darkness and light section', (await dm.locator('.modal h4', { hasText: 'Darkness and light' }).count()) === 1);
await dm.locator('.modal .btn', { hasText: /^60 ft$/ }).nth(1).click(); // the second row of chips is darkvision
await dm.locator('.modal .btn', { hasText: /^Lantern$/ }).click();
check('picking a lantern shows its two distances', (await dm.locator('.modal label.field-label', { hasText: 'Bright' }).count()) === 1);
await dm.locator('.modal .btn.primary', { hasText: 'Save' }).click();
await sleep(500);
const edited = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { dv: t.dv, light: t.light }; }, elf);
check('saving keeps the darkvision and the lantern', edited.dv === 60 && edited.light && edited.light.b === 30 && edited.light.d === 30, JSON.stringify(edited));
// a light of a token hidden from the players is not shining for them
const beforeHide = await shadeAt(X + 18 * cell, Y);
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { hidden: true }), elf);
await sleep(600);
check('hiding the token puts its light out', ((await shadeAt(X + 18 * cell, Y)) ?? 0) > 0.8 && (beforeHide ?? 1) < 0.5, `${beforeHide}`);
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { hidden: false }), elf);
await sleep(400);

// ---- back to daylight
await dm.screenshot({ path: '/tmp/shots/u8-before-daylight.png' });
console.log('buttons:', JSON.stringify(await dm.locator('button').evaluateAll((b) => b.map((x) => x.textContent.trim()).filter((t) => /Daylight|Twilight|Dark/.test(t)))));
await dm.locator('.seg button', { hasText: /^Daylight$/ }).click();
await sleep(500);
check('daylight takes the dark away again', (await lightVisible()) === false && (await maskKind()) !== 's');
await dm.locator('.seg button', { hasText: /^Twilight$/ }).click();
await sleep(500);
const twi = await shadeAt(X + 13 * cell, Y - 8 * cell);
check('twilight is dimmer than daylight and lighter than the dark', twi !== null && twi > 0.3 && twi < 0.6 && (await lightVisible()) === true, String(twi));
check('and in twilight nobody is held to the lit ground (no lit-shape cut in the fog)', (await maskKind()) !== 's');
await dm.keyboard.press('Control+z');
await sleep(300);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
