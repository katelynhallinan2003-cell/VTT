// Round 7a: top bar items flush at the top, WASD pan, new hotkeys, summon wording, handout popup over other windows,
// template permission and privacy, test move ends when another tool is picked, teleport.
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
await dm.getByPlaceholder('New table name').fill('Y');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
check('the new scene window explains what summoning does', /moved onto this scene/.test(await dm.locator('.modal').innerText()) && /Summon players to it/.test(await dm.locator('.modal').innerText()));
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);
const cell = await dm.evaluate(() => window.__vtt.client.grid.cell);
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));

// ---- summon vs bring here
check('on the live scene there is no Summon button', (await dm.getByRole('button', { name: 'Summon players' }).count()) === 0);
check('and the bring-everyone-here button is there', (await dm.getByRole('button', { name: 'Bring players here' }).count()) === 1);
await dm.evaluate(async () => { await window.__vtt.client.createScene({ name: 'Second', makeActive: false }); });
await dm.waitForFunction(() => window.__vtt.client.sceneIndex.length === 2);
await dm.evaluate(() => { const c = window.__vtt.client; c.openScene(c.sceneIndex.find((s) => s.name === 'Second').id); });
await sleep(500);
check('on a private scene the button says Summon players', (await dm.getByRole('button', { name: 'Summon players' }).count()) === 1);
check('and there is nothing to bring players to', (await dm.getByRole('button', { name: 'Bring players here' }).count()) === 0);
const chip = await dm.locator('.topchip.warn').boundingBox();
const vw = 1400;
check('the private-scene note hangs from the top edge, in the middle', chip && chip.y <= 1 && Math.abs(chip.x + chip.width / 2 - vw / 2) < 6, JSON.stringify(chip));
await dm.screenshot({ path: '/tmp/shots/y1-private.png' });
await dm.evaluate(() => { const c = window.__vtt.client; c.openScene(c.sceneIndex.find((s) => s.name !== 'Second').id); });
await dm.waitForFunction(() => window.__vtt.client.scene?.loaded && window.__vtt.client.scene.meta.name !== 'Second');
await sleep(500);

// ---- test move bar flush at the top
await dm.keyboard.press('m');
const tb = await dm.locator('.testbar').boundingBox();
// flush with the top edge when it fits between the two halves of the top bar; just under the top bar when it does not, and never over it
const pills = await dm.locator('.pill').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.left, r: r.right, b: r.bottom }; }));
const clearOfPills = tb && pills.every((q) => tb.y >= q.b || tb.x >= q.r || tb.x + tb.width <= q.x);
check('the test-move box is at the top edge, or just under the top bar when there is no room beside it', tb && clearOfPills && (tb.y <= 1 || tb.y < 80), JSON.stringify(tb));
await dm.screenshot({ path: '/tmp/shots/y2-testbar.png' });
await dm.getByRole('button', { name: /^Draw and write/ }).click().catch(() => dm.keyboard.press('p'));
await sleep(200);
check('picking another tool ends the test move', (await dm.locator('.testbar').count()) === 0 && (await dm.evaluate(() => window.__vtt.ui.data.testMove)) === false);
await dm.keyboard.press('v');

// ---- tool hotkeys
await dm.keyboard.press('p');
check('P is the draw tool', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'draw');
await dm.keyboard.press('c');
check('C is spell templates', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'template');
await dm.keyboard.press('v');
await dm.keyboard.press('s');
check('S no longer switches tools (it pans)', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'select');
await dm.keyboard.press('Escape');

// ---- WASD
const rect0 = await dm.evaluate(() => window.__vtt.board.viewRect());
await dm.keyboard.down('d'); await sleep(500); await dm.keyboard.up('d');
const rect1 = await dm.evaluate(() => window.__vtt.board.viewRect());
check('D pans the view right', rect1.x > rect0.x + 20, `${Math.round(rect0.x)} -> ${Math.round(rect1.x)}`);
await dm.keyboard.down('s'); await sleep(500); await dm.keyboard.up('s');
const rect2 = await dm.evaluate(() => window.__vtt.board.viewRect());
check('S pans down', rect2.y > rect1.y + 20, `${Math.round(rect1.y)} -> ${Math.round(rect2.y)}`);
await dm.keyboard.down('a'); await sleep(500); await dm.keyboard.up('a');
await dm.keyboard.down('w'); await sleep(500); await dm.keyboard.up('w');
const rect3 = await dm.evaluate(() => window.__vtt.board.viewRect());
check('A and W pan back', rect3.x < rect2.x - 20 && rect3.y < rect2.y - 20);
const still = await dm.evaluate(() => window.__vtt.board.viewRect());
await sleep(400);
const still2 = await dm.evaluate(() => window.__vtt.board.viewRect());
check('it stops when the key is let go', Math.abs(still.x - still2.x) < 0.5 && Math.abs(still.y - still2.y) < 0.5);
check('and no tool changed', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'select');
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(300);

// ---- tokens: hotkeys, teleport
const ids = await dm.evaluate(async () => {
  const c = window.__vtt.client;
  const a = await c.addToken({ x: 175, y: 175, name: 'Alpha' });
  const b = await c.addToken({ x: 315, y: 175, name: 'Beta' });
  return [a, b];
});
await sleep(400);
await dm.keyboard.press('Tab');
const sel1 = await dm.evaluate(() => [...window.__vtt.ui.data.selection]);
check('Tab selects a token', sel1.length === 1);
await dm.keyboard.press('Tab');
const sel2 = await dm.evaluate(() => [...window.__vtt.ui.data.selection]);
check('and the next Tab the other one', sel2.length === 1 && sel2[0] !== sel1[0]);
await dm.keyboard.press('k');
check('K hides the selected token from players', (await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id)?.hidden, sel2[0])) === true);
await dm.keyboard.press('k');
check('and K again reveals it', (await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id)?.hidden, sel2[0])) === false);
await dm.keyboard.press('l');
check('L locks it', (await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id)?.locked, sel2[0])) === true);
await dm.keyboard.press('l');
await dm.keyboard.down('q');
check('holding Q says that teleport is on', /Teleport/.test(await dm.locator('.status').innerText().catch(() => '')));
await dm.keyboard.up('q');
await sleep(150);
check('and lets go of it', (await dm.locator('.status').count()) === 0);
// right-click the ground: teleport the selected token there
const target = { x: 5.5 * cell, y: 9.5 * cell };
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(300);
const scr = await dm.evaluate((t) => window.__vtt.board.worldToScreen(t), target);
await dm.mouse.click(scr.x, scr.y, { button: 'right' });
await sleep(300);
console.log('menu:', JSON.stringify(await dm.evaluate(() => document.querySelector('.ctx')?.innerText ?? 'no menu')), JSON.stringify(scr), JSON.stringify(await dm.evaluate(() => [...window.__vtt.ui.data.selection])));
await dm.screenshot({ path: '/tmp/shots/y-menu.png' });
await dm.getByRole('button', { name: /Teleport selected token here/ }).click({ timeout: 5000 });
await sleep(400);
const pos = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { x: t.x, y: t.y }; }, sel2[0]);
check('the right-click menu teleports the token there', Math.abs(pos.x - target.x) < cell && Math.abs(pos.y - target.y) < cell, JSON.stringify(pos));

// ---- settings list
await dm.keyboard.press('Escape');
await dm.keyboard.press('Shift+Slash');
await dm.locator('.modal', { hasText: 'Shortcuts' }).waitFor();
const keys = await dm.locator('.keys').innerText();
check('the bottom shortcut gives the DM teleport gesture', /Hold Q and drag a token to teleport/.test(await dm.locator('.keys li').last().innerText()));
check('the hotkey list covers the new keys', /pan the view/.test(keys) && /teleport/i.test(keys) && /spell templates/.test(keys) && /next \/ previous token/.test(keys));
await dm.screenshot({ path: '/tmp/shots/y3-keys.png' });
await dm.keyboard.press('Escape');

// ---- a player
const pl = await context.newPage();
watch(pl, 'Aria', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await pl.waitForFunction(() => window.__vtt?.client?.scene?.loaded);
await sleep(900);
// the claim window is open on the player: a handout still opens over it
check('the player has the claim window open', (await pl.locator('.modal', { hasText: 'Pick your character' }).count()) === 1);
await dm.bringToFront();
const hid = await dm.evaluate(async () => { const c = window.__vtt.client; const id = await c.saveHandout({ title: 'Warning', text: 'The bridge is out.', img: null }); await c.showHandout(id, null); return id; });
await pl.bringToFront();
await pl.locator('.modal', { hasText: 'The bridge is out.' }).waitFor({ timeout: 8000 });
check('a handout opens over another open window', true);
await pl.keyboard.press('Escape');
await sleep(200);
check('closing it leaves the other window as it was', (await pl.locator('.modal', { hasText: 'Pick your character' }).count()) === 1);
await pl.keyboard.press('Escape');
await sleep(200);

// templates: allowed for players even with drawing turned off
await dm.bringToFront();
await dm.evaluate(async () => { const c = window.__vtt.client; await c.setPermissions({ playersMoveAnyToken: false, playersCreateTokens: false, playersDeleteAnyToken: false, playersPing: true, playersDraw: false, playersTemplates: true, playersMeasure: true }); });
await pl.bringToFront();
await pl.waitForFunction(() => window.__vtt.client.settings.perm.playersDraw === false);
check('the template button is on for a player when only drawing is off', (await pl.getByRole('button', { name: /Spell templates/ }).isEnabled()) && !(await pl.getByRole('button', { name: /Draw and write/ }).isEnabled()));
await pl.keyboard.press('c');
const p0 = await pl.evaluate((t) => window.__vtt.board.worldToScreen(t), { x: 6 * cell, y: 6 * cell });
const p1 = await pl.evaluate((t) => window.__vtt.board.worldToScreen(t), { x: 9 * cell, y: 6 * cell });
await pl.mouse.move(p0.x, p0.y); await pl.mouse.down(); await pl.mouse.move((p0.x + p1.x) / 2, p0.y, { steps: 4 }); await pl.mouse.move(p1.x, p1.y, { steps: 4 }); await pl.mouse.up();
await sleep(500);
const nTpl = await pl.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'cone').length);
check('a player can place a spell template', nTpl === 1, `${nTpl}`);
check('and no error was shown', (await pl.locator('.toast.error').count()) === 0);
await pl.keyboard.press('p');
check('but drawing stays off for them', (await pl.evaluate(() => window.__vtt.ui.data.tool)) !== 'draw');

// private templates
await pl.keyboard.press('Escape');
await pl.evaluate(() => window.__vtt.ui.set({ tplShare: false }));
await pl.keyboard.press('c');
const q0 = await pl.evaluate((t) => window.__vtt.board.worldToScreen(t), { x: 6 * cell, y: 9 * cell });
const q1 = await pl.evaluate((t) => window.__vtt.board.worldToScreen(t), { x: 9 * cell, y: 9 * cell });
await pl.mouse.move(q0.x, q0.y); await pl.mouse.down(); await pl.mouse.move((q0.x + q1.x) / 2, q0.y, { steps: 4 }); await pl.mouse.move(q1.x, q1.y, { steps: 4 }); await pl.mouse.up();
await sleep(500);
const mine = await pl.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'cone').length);
const meSees = await pl.evaluate(() => window.__vtt.board.drawingsShown().filter((d) => d.k === 'cone').length);
check('a second template kept private is still there for its maker', mine === 2 && meSees === 2, `${mine}/${meSees}`);
await dm.bringToFront();
await sleep(300);
const dmSees = await dm.evaluate(() => window.__vtt.board.drawingsShown().filter((d) => d.k === 'cone').length);
check('the DM sees both', dmSees === 2, `${dmSees}`);
const pl2 = await context.newPage();
watch(pl2, 'Bram', errors);
await pl2.goto(`${BASE}#/t/${tid}`);
await pl2.getByPlaceholder('e.g. Aria').fill('Bram');
await pl2.getByRole('button', { name: 'Join table' }).click();
await pl2.waitForSelector('.board-host canvas');
await pl2.waitForFunction(() => window.__vtt?.client?.scene?.loaded && window.__vtt.client.scene.draws.size >= 2);
await sleep(500);
const bramSees = await pl2.evaluate(() => window.__vtt.board.drawingsShown().filter((d) => d.k === 'cone').length);
check('another player sees only the shared one', bramSees === 1, `${bramSees}`);
await pl2.evaluate(() => { localStorage.removeItem('vtt-tpl-share'); });
await pl2.reload();
await pl2.waitForFunction(() => window.__vtt?.client?.scene?.loaded);
await pl2.evaluate(() => window.__vtt.ui.set({ tool: 'template' }));
await sleep(300);
check('the share toggle is in the template panel and on by default', (await pl2.locator('.flyout', { hasText: 'Show others my templates' }).count()) === 1 && (await pl2.evaluate(() => window.__vtt.ui.data.tplShare)) === true);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
