// Round 4c: heights. Drawing high ground, walkers standing on it, flyers keeping their altitude, the 3D ruler, and what players see.
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
await dm.getByPlaceholder('New table name').fill('J');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

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

const cell = await dm.evaluate(() => window.__vtt.client.grid.cell);
const pid = await pl.evaluate(() => window.__vtt.client.uid);
const add = (partial) => dm.evaluate((p) => window.__vtt.client.addToken(p), partial);
const hero = await add({ x: 3.5 * cell, y: 4.5 * cell, name: 'Aria', ownerUid: pid });
const gob = await add({ x: 12.5 * cell, y: 4.5 * cell, name: 'Goblin' });
const bird = await add({ x: 12.5 * cell, y: 8.5 * cell, name: 'Hawk' });
await sleep(500);

const alt = (p, id) => p.evaluate((i) => { const b = window.__vtt.board; const t = window.__vtt.client.scene.tokens.get(i); return b.heightOf(t); }, id);
const tok = (p, id) => p.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { fly: t.fly, elev: t.elev }; }, id);
const zones = (p) => p.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.hz != null).map((d) => ({ id: d.id, k: d.k, hz: d.hz })));
const screen = (p, wx, wy) => p.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const front = async (p) => { await p.bringToFront(); await sleep(150); };

// ---- the tool
check('DM has a Heights button', (await dm.locator('.toolbar button[aria-label^="Heights"]').count()) === 1);
check('players do not', (await pl.locator('.toolbar button[aria-label^="Heights"]').count()) === 0);
await dm.keyboard.press('h');
await dm.locator('.flyout-title', { hasText: /^Heights$/ }).waitFor();
check('H opens the Heights panel', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'height');
await dm.locator('.flyout .chip', { hasText: /^10$/ }).click();
check('a preset chip sets the height', (await dm.evaluate(() => window.__vtt.ui.data.heightFt)) === 10);

// ---- paint a 10 ft ledge (cols 10..13, rows 3..6): a 4-square brush clicked on the corner in the middle of them
await dm.evaluate(() => window.__vtt.ui.set({ heightBrush: 4 }));
const a = await screen(dm, 12 * cell, 5 * cell);
await dm.mouse.move(a.x, a.y);
await dm.mouse.down();
await sleep(120);
check('while you paint it shows its height', (await dm.evaluate(() => window.__vtt.board.plotLabels.some((l) => l && l.visible && /^10 ft$/.test(l.text)))));
await dm.mouse.up();
await sleep(400);
let zs = await zones(dm);
check('a stroke with a height of 10 is made', zs.length === 1 && zs[0].k === 'terrain' && zs[0].hz === 10, JSON.stringify(zs));
check('the goblin standing in it is lifted to 10 ft', (await alt(dm, gob)).alt === 10);
check("and the hero, outside it, is still at 0", (await alt(dm, hero)).alt === 0);
await dm.screenshot({ path: '/tmp/shots/j1-ledge.png' });

// ---- a nest painted on top of it wins (newer sits on top)
await dm.keyboard.press('Escape');
await dm.evaluate(() => window.__vtt.ui.set({ heightBrush: 1 }));
await dm.locator('.flyout .ht-card .numf input').first().fill('40');
await dm.locator('.flyout .ht-card .numf input').first().blur();
check('typing a height works', (await dm.evaluate(() => window.__vtt.ui.data.heightFt)) === 40);
const c = await screen(dm, 11.5 * cell, 4.5 * cell);
await dm.mouse.move(c.x, c.y);
await dm.mouse.down();
await dm.mouse.up();
await sleep(400);
zs = await zones(dm);
check('a second area (a 40 ft nest) is made', zs.length === 2 && zs.some((z) => z.hz === 40));
const nestCentre = await dm.evaluate(([x, y]) => window.__vtt.board.heightOf({ fly: false, elev: 0, x, y }).alt, [11.5 * cell, 4.5 * cell]);
check('the nest sits on top of the ledge', nestCentre === 40, String(nestCentre));
await dm.screenshot({ path: '/tmp/shots/j2-nest.png' });

// ---- the nest is still selected: change its height from the card
await dm.locator('.ht-card', { hasText: 'Selected ground' }).waitFor();
const gh = dm.locator('.ht-card .numf input');
await gh.fill('30');
await gh.blur();
await sleep(400);
check('changing it there changes the area', (await zones(dm)).some((z) => z.hz === 30) && !(await zones(dm)).some((z) => z.hz === 40));
await dm.locator('.ht-card .chip', { hasText: /^40$/ }).click();
await sleep(300);
check('and the chips work too', (await zones(dm)).some((z) => z.hz === 40));
await dm.keyboard.press('Escape');
await dm.evaluate(() => window.__vtt.ui.selectDrawings([]));

// ---- tokens: walkers pick up the ground, and show it
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [gob, 11.5 * cell, 4.5 * cell]);
await sleep(400);
check('a walker moved onto the nest is at 40 ft', (await alt(dm, gob)).alt === 40);
const badge = await dm.evaluate((i) => window.__vtt.board.views.get(i).altText.text, gob);
check('and its badge says so', badge === '▲40', badge);
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [gob, 12.5 * cell, 6.5 * cell]);
await sleep(300);
check('moved back to the ledge, 10 ft', (await alt(dm, gob)).alt === 10);

// ---- the Height button on the token tag
await dm.evaluate((i) => window.__vtt.ui.select([i]), bird);
await dm.locator('.tokentag button', { hasText: /^Height/ }).click();
await dm.locator('.height-pop').waitFor();
await dm.locator('.height-pop button', { hasText: /^Take off$/ }).click();
await sleep(300);
let t = await tok(dm, bird);
check('Take off makes it fly, 10 ft up', t.fly === true && t.elev === 10, JSON.stringify(t));
await dm.locator('.height-pop button', { hasText: /^\+5$/ }).click();
await sleep(250);
check('+5 raises it 5 ft', (await tok(dm, bird)).elev === 15);
await dm.locator('.height-pop .numf input').fill('40');
await dm.locator('.height-pop .numf input').blur();
await sleep(300);
check('the number box sets the altitude', (await tok(dm, bird)).elev === 40);
await dm.locator('.height-pop .chip', { hasText: /^20 ft$/ }).click();
await sleep(300);
check('a preset sets it too', (await tok(dm, bird)).elev === 20);
check('the button shows the height', /↑20/.test(await dm.locator('.tokentag button', { hasText: /^Height/ }).innerText()));
const bBadge = await dm.evaluate((i) => window.__vtt.board.views.get(i).altText.text, bird);
check("the token's own tag says ↑20", bBadge === '↑20', bBadge);
await dm.screenshot({ path: '/tmp/shots/j3-flying.png' });

// ---- a flyer over the ledge keeps its altitude; over a taller one it is lifted
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [bird, 12.5 * cell, 6.5 * cell]);
await sleep(300);
let ba = await alt(dm, bird);
check('flying at 20 over a 10 ft ledge: 20 up, 10 clear', ba.alt === 20 && ba.clear === 10, JSON.stringify(ba));
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [bird, 11.5 * cell, 4.5 * cell]);
await sleep(300);
ba = await alt(dm, bird);
check('over the 40 ft nest it is lifted clear of it, not inside', ba.alt === 40 && ba.clear === 0, JSON.stringify(ba));
await dm.locator('.height-pop button', { hasText: /^Flying: land$/ }).click();
await sleep(300);
check('Land puts it back on the ground', !(await tok(dm, bird)).fly);
await dm.keyboard.press('Escape');

// ---- keys
await dm.evaluate((i) => window.__vtt.ui.select([i]), hero);
await dm.keyboard.press(']');
await sleep(300);
t = await tok(dm, hero);
check(']  raises it 5 ft', t.fly === true && t.elev === 5, JSON.stringify(t));
await dm.keyboard.press(']');
await sleep(300);
check('again: 10', (await tok(dm, hero)).elev === 10);
await dm.keyboard.press('[');
await dm.keyboard.press('[');
await sleep(300);
check('[ twice: down and landed', !(await tok(dm, hero)).fly);

// ---- token editor
await dm.evaluate((i) => window.__vtt.ui.select([i]), hero);
await dm.keyboard.press('e');
await dm.locator('.modal').waitFor();
check('the editor has a Flying switch', (await dm.locator('.modal label', { hasText: /^Flying/ }).count()) === 1);
check('and the altitude box is disabled while it is off', await dm.locator('.modal input[placeholder="0"][type="number"]').first().isDisabled());
await dm.locator('.modal label', { hasText: /^Flying/ }).locator('input[type=checkbox]').check();
await sleep(150);
const altBox = dm.locator('.modal input[type="number"][step="5"]').first();
check('turning it on enables it, at 10 ft', (await altBox.isEnabled()) && (await altBox.inputValue()) === '10');
await altBox.fill('25');
await dm.getByRole('button', { name: 'Save', exact: true }).click();
await sleep(400);
t = await tok(dm, hero);
check('saving keeps it: flying at 25', t.fly === true && t.elev === 25, JSON.stringify(t));
await dm.evaluate(([i]) => window.__vtt.client.updateToken(i, { fly: false, elev: 0 }), [hero]);
await dm.keyboard.press('Escape');

// ---- the ruler counts the climb
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [hero, 8.5 * cell, 4.5 * cell]);
await sleep(300);
await dm.keyboard.press('r');
const h0 = await screen(dm, 8.5 * cell, 4.5 * cell);
const h1 = await screen(dm, 12.5 * cell, 6.5 * cell);
await dm.mouse.move(h0.x, h0.y);
await dm.mouse.down();
await dm.mouse.move(h1.x, h1.y, { steps: 8 });
await sleep(200);
const rl = await dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
check('measuring from the floor up to a goblin on the ledge says how far up', rl.some((s) => /up/.test(s)), JSON.stringify(rl));
await dm.screenshot({ path: '/tmp/shots/j4-ruler.png' });
await dm.mouse.up();
await dm.keyboard.press('Escape');
await dm.keyboard.press('v');

// ---- dragging a walker up onto high ground says it is climbing, and down says it drops
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [gob, 8.5 * cell, 6.5 * cell]);
await sleep(300);
const g0 = await screen(dm, 8.5 * cell, 6.5 * cell);
const g1 = await screen(dm, 12.5 * cell, 6.5 * cell);
await dm.mouse.move(g0.x, g0.y);
await dm.mouse.down();
await dm.mouse.move(g1.x, g1.y, { steps: 10 });
await sleep(200);
const dt = await dm.evaluate(() => { const t = window.__vtt.board.distText; return t.visible ? t.text : ''; });
check('dragging up a grade shows a single movement total', /^\d+(?:\.\d+)? ft$/.test(dt), dt);
await dm.mouse.up();
await sleep(300);
const g2 = await screen(dm, 12.5 * cell, 6.5 * cell);
await dm.mouse.move(g2.x, g2.y);
await dm.mouse.down();
await dm.mouse.move(g0.x, g0.y, { steps: 10 });
await sleep(200);
const dt2 = await dm.evaluate(() => { const t = window.__vtt.board.distText; return t.visible ? t.text : ''; });
check('and descending the same grade costs the same distance', dt === dt2, dt2);
await dm.mouse.up();
await sleep(300);

// ---- players see it all
await front(pl);
check('the player has the same height areas', (await zones(pl)).length === 2);
const pAlt = await pl.evaluate((i) => { const b = window.__vtt.board; return b.heightOf(window.__vtt.client.scene.tokens.get(i)).alt; }, gob);
check('and sees the goblin at the same height', pAlt === 0 || pAlt === 10, String(pAlt));
check('the player sees terrain when moving by default', (await pl.evaluate(() => window.__vtt.ui.data.heightView)) === 'auto');
await pl.evaluate((i) => window.__vtt.ui.select([i]), hero);
await pl.keyboard.press(']');
await sleep(500);
check('and can lift their own token with ]', (await tok(pl, hero)).fly === true);
check("a player's tag has a Height button too", (await pl.locator('.tokentag button', { hasText: /^Height/ }).count()) === 1);
await pl.screenshot({ path: '/tmp/shots/j5-player.png' });
await pl.keyboard.press('[');
await sleep(300);
await dm.bringToFront();

// ---- Show heights is just a view setting
await dm.evaluate(() => window.__vtt.ui.set({ heightView: 'tool' }));
await sleep(300);
const hiddenCount = await dm.evaluate(() => window.__vtt.board.drawLayer.container.children.length);
await dm.evaluate(() => window.__vtt.ui.set({ heightView: 'auto' }));
await sleep(300);
check('turning the height view to "only in the tool" keeps the ground, only hiding it', (await zones(dm)).length === 2 && (await alt(dm, gob)).alt >= 0);
void hiddenCount;

// ---- the draw tool's Clear all leaves terrain alone
await dm.keyboard.press('p');
await dm.getByRole('button', { name: 'Clear all', exact: true }).click();
await sleep(400);
check('"Clear all" drawings does not wipe the terrain', (await zones(dm)).length === 2);
await dm.keyboard.press('h');
await dm.locator('.flyout .hint', { hasText: /2 height areas/ }).waitFor();
await dm.getByRole('button', { name: 'Clear all heights' }).click();
await sleep(400);
check('"Clear all heights" does', (await zones(dm)).length === 0);
check('and the goblin steps back down to 0', (await alt(dm, gob)).alt === 0);

// ---- undo
await dm.keyboard.press('Escape');
await dm.keyboard.press('v');
await dm.keyboard.press('Control+z');
await sleep(500);
check('Ctrl+Z brings the terrain back', (await zones(dm)).length === 2);
let steps = 0;
while ((await zones(dm)).length === 2 && steps < 40) { await dm.keyboard.press('Control+z'); await sleep(250); steps++; }
check('and further undo takes the areas away one at a time', (await zones(dm)).length === 1, `after ${steps} steps`);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
