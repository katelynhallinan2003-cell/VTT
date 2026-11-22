// Round 6b: heights. The ground fades in only while something moves over it, flyers are measured above the ground, labels give the real height.
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
await dm.getByPlaceholder('New table name').fill('R');
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
const ground = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.groundAtPoint({ x, y }), [wx, wy]);
const fade = () => dm.evaluate(() => window.__vtt.board.heightFade);
const layerShown = () => dm.evaluate(() => window.__vtt.board.terrainLayer.container.visible && window.__vtt.board.terrainLayer.container.alpha > 0.5);
const tok = (id) => dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return { x: t.x, y: t.y, fly: t.fly, elev: t.elev }; }, id);
const alt = (id) => dm.evaluate((i) => window.__vtt.board.heightOf(window.__vtt.client.scene.tokens.get(i)), id);
const badge = (id) => dm.evaluate((i) => window.__vtt.board.views.get(i).altText.text, id);
const drag = async (a, b, opts = {}) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await dm.mouse.move(q.x, q.y, { steps: 4 });
  if (opts.peek) await opts.peek();
  await dm.mouse.up();
  await sleep(350);
};

// ---- paint a 20 ft ledge and a -10 ft pit with the Heights tool
await dm.keyboard.press('h');
await dm.locator('.flyout-title', { hasText: /^Heights$/ }).waitFor();
await dm.evaluate(() => window.__vtt.ui.set({ heightMode: 'paint', heightSnap: true, heightBrush: 2, heightFt: 20, heightAdds: false }));
await drag([cx(10), cy(10)], [cx(13), cy(10)]);
await dm.evaluate(() => window.__vtt.ui.selectDrawings([]));
await dm.evaluate(() => window.__vtt.ui.set({ heightFt: -10 }));
await drag([cx(10), cy(16)], [cx(13), cy(16)]);
await dm.evaluate(() => window.__vtt.ui.selectDrawings([]));
check('the ledge is 20 ft', (await ground(cx(11), cy(10))) === 20, String(await ground(cx(11), cy(10))));
check('the pit is -10 ft', (await ground(cx(11), cy(16))) === -10, String(await ground(cx(11), cy(16))));

// ---- in the Heights tool the ground is shown, with labels that give the real height
await sleep(500);
check('the Heights tool shows the ground', (await fade()) === 1 && (await layerShown()));
const labels = await dm.evaluate(() => [...window.__vtt.board.terrainLayer.labels.values()].map((t) => t.text).sort());
check('and names each area by its real height', labels.length === 2 && labels.includes('20 ft') && labels.includes('-10 ft'), JSON.stringify(labels));
await dm.screenshot({ path: '/tmp/shots/r1-tool.png' });

// ---- an area that adds shows the total, and what it adds
await dm.evaluate(() => window.__vtt.ui.set({ heightFt: 5, heightAdds: true }));
await drag([cx(11), cy(10)], [cx(12), cy(10)]);
await sleep(400);
const labels2 = await dm.evaluate(() => [...window.__vtt.board.terrainLayer.labels.values()].map((t) => t.text).sort());
check('a 5 ft step on the 20 ft ledge says 25 ft (+5)', labels2.includes('25 ft (+5)'), JSON.stringify(labels2));
await dm.evaluate(() => window.__vtt.ui.selectDrawings([]));
check('the card calls it "On top of ground" and the field "Raise by"', (await dm.locator('.ht-card .seg button.on', { hasText: 'Added on top' }).count()) === 1);

// ---- leaving the tool hides it again
await dm.keyboard.press('v');
await sleep(700);
check('selecting hides the ground again (when moving mode)', (await fade()) === 0 && !(await layerShown()), String(await fade()));
check('the setting defaults to "when moving"', (await dm.evaluate(() => window.__vtt.ui.data.heightView)) === 'auto');

// ---- dragging a token shows it, letting go fades it out
const gob = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Goblin' }), [cx(5), cy(5)]);
await sleep(400);
await drag([cx(5), cy(5)], [cx(8), cy(7)], { peek: async () => {
  await sleep(450);
  check('dragging a token shows the ground', (await fade()) === 1 && (await layerShown()), String(await fade()));
  await dm.screenshot({ path: '/tmp/shots/r2-dragging.png' });
} });
await sleep(700);
check('and it fades away after letting go', (await fade()) === 0);

// ---- the ruler shows it too
await dm.keyboard.press('r');
await sleep(100);
const a = await screen(cx(5), cy(5)), b = await screen(cx(9), cy(5));
await dm.mouse.move(a.x, a.y); await dm.mouse.down(); await dm.mouse.move(b.x, b.y, { steps: 5 });
await sleep(450);
check('measuring shows the ground', (await fade()) === 1);
await dm.mouse.up();
await dm.keyboard.press('v');
await sleep(700);
check('and it fades after measuring', (await fade()) === 0);

// ---- an arrow-key step shows it for a moment
await dm.evaluate((i) => window.__vtt.ui.select([i]), gob);
await dm.keyboard.press('ArrowRight');
await sleep(400);
check('a keyboard step shows the ground briefly', (await fade()) === 1);
await sleep(2400);
check('then lets it fade', (await fade()) === 0, String(await fade()));

// ---- always / only in the tool
await dm.evaluate(() => window.__vtt.ui.set({ heightView: 'always' }));
await sleep(500);
check('"Always" keeps the ground on screen', (await fade()) === 1 && (await layerShown()));
await dm.screenshot({ path: '/tmp/shots/r3-always.png' });
await dm.evaluate(() => window.__vtt.ui.set({ heightView: 'tool' }));
await sleep(700);
await drag([cx(8), cy(7)], [cx(6), cy(6)], { peek: async () => {
  await sleep(450);
  check('"Only in the tool" does not show it while dragging', (await fade()) === 0);
} });
await dm.evaluate(() => window.__vtt.ui.set({ heightView: 'auto' }));
await sleep(300);

// ---- the setting is in the panel and remembered
await dm.keyboard.press('h');
await dm.locator('.flyout-title', { hasText: /^Heights$/ }).waitFor();
check('the Heights panel has the three choices', (await dm.locator('.flyout .seg button', { hasText: /^(When moving|Always|In tool)$/ }).count()) === 3);
await dm.locator('.flyout .seg button', { hasText: /^Always$/ }).click();
check('choosing one changes the setting', (await dm.evaluate(() => window.__vtt.ui.data.heightView)) === 'always');
check('and remembers it', (await dm.evaluate(() => localStorage.getItem('vtt-height-view'))) === 'always');
await dm.locator('.flyout .seg button', { hasText: /^When moving$/ }).click();
await dm.keyboard.press('v');

// ---- flyers are measured above the ground
const bird = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Bird' }), [cx(3), cy(3)]);
await sleep(400);
await dm.evaluate((i) => window.__vtt.client.updateToken(i, { fly: true, elev: 20 }), bird);
await sleep(300);
check('over flat ground, 20 up is ↑20', (await badge(bird)) === '↑20', await badge(bird));
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [bird, cx(11), cy(16)]);
await sleep(500);
const over = await alt(bird);
check('straight over the 10 ft pit it is 30 up, with the same elevation', over.clear === 30 && over.alt === 20 && (await tok(bird)).elev === 20, JSON.stringify(over));
check('and the badge says ↑30', (await badge(bird)) === '↑30', await badge(bird));
await dm.evaluate((i) => window.__vtt.ui.select([i]), bird);
await dm.locator('.tokentag button', { hasText: /^Height/ }).click();
await dm.locator('.height-pop').waitFor();
check('the Height button shows ↑30', /↑30/.test(await dm.locator('.tokentag button', { hasText: /^Height/ }).innerText()));
check('the popup box is "Above ground" and shows 30', (await dm.locator('.height-pop .numf span', { hasText: 'Above ground' }).count()) === 1 && (await dm.locator('.height-pop .numf input').inputValue()) === '30');
await dm.locator('.height-pop .numf input').fill('15');
await dm.locator('.height-pop .numf input').blur();
await sleep(400);
check('typing 15 puts it 15 above the pit (elevation 5)', (await tok(bird)).elev === 5 && (await alt(bird)).clear === 15, JSON.stringify(await tok(bird)));
await dm.locator('.height-pop .chip', { hasText: /^20 ft$/ }).click();
await sleep(300);
check('the 20 ft chip is 20 above the ground', (await alt(bird)).clear === 20 && (await tok(bird)).elev === 10);
await dm.locator('.height-pop button', { hasText: /^\+5$/ }).click();
await sleep(300);
check('+5 goes 5 higher', (await alt(bird)).clear === 25);
// onto the ledge (the 5 ft step is on top of it there, so 25 ft): the elevation stays, so it is lifted clear of the ground
await dm.evaluate(([i, x, y]) => window.__vtt.client.updateToken(i, { x, y }), [bird, cx(11), cy(10)]);
await sleep(500);
const onLedge = await alt(bird);
const g = await ground(cx(11), cy(10));
check('crossing onto higher ground than its elevation sits it on top (nothing clear)', onLedge.clear === 0 && onLedge.alt === g, JSON.stringify(onLedge));
await dm.evaluate(([i, e]) => window.__vtt.client.updateToken(i, { fly: true, elev: e }), [bird, g + 15]);
await sleep(400);
check('15 over that ground reads ↑15', (await badge(bird)) === '↑15', await badge(bird));

// ---- the token editor says the same
await dm.locator('.tokentag button', { hasText: /^Edit$/ }).click();
await dm.locator('.modal').waitFor();
const elevBox = dm.locator('.modal label.field', { hasText: 'Height above the ground' }).locator('input');
check('the editor field is "Height above the ground" and shows 15', (await elevBox.count()) === 1 && (await elevBox.inputValue()) === '15', (await elevBox.count()) ? await elevBox.inputValue() : 'none');
await elevBox.fill('25');
await dm.getByRole('button', { name: 'Save', exact: true }).click();
await sleep(500);
check('saving 25 puts it 25 above that ground', (await tok(bird)).elev === g + 25 && (await alt(bird)).clear === 25, JSON.stringify(await tok(bird)));

const bad = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
if (bad.length) console.log('ERRORS:\n' + bad.join('\n'));
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) && !bad.length ? 0 : 1);
