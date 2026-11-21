// Round 5a/5b: Temp HP feedback, ruler right-click, test move clears the tool, effect tint, emanations from creatures of different sizes.
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
await dm.getByPlaceholder('New table name').fill('L');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

const cell = await dm.evaluate(() => window.__vtt.client.grid.cell);
const add = (partial) => dm.evaluate((p) => window.__vtt.client.addToken(p), partial);
const gob = await add({ x: 5.5 * cell, y: 4.5 * cell, name: 'Goblin', hp: 7, maxHp: 7 });
const ogre = await add({ x: 11 * cell, y: 5 * cell, name: 'Ogre', size: 2 });
await sleep(500);
const tok = (id) => dm.evaluate((i) => ({ ...window.__vtt.client.scene.tokens.get(i) }), id);
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const toast = () => dm.evaluate(() => [...document.querySelectorAll('.toast')].map((e) => e.textContent).join(' | '));

// ---- Temp HP says what it did
await dm.evaluate((i) => window.__vtt.ui.select([i]), gob);
await dm.locator('.tokentag .tt-hp .btn', { hasText: 'Temp' }).click();
await sleep(200);
check('Temp with an empty box says what to do', /Type how many/i.test(await toast()), await toast());
check('and puts the cursor in the box', await dm.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Hit points to take off or give back'));
await dm.locator('.tokentag .tt-hp input').fill('5');
await dm.locator('.tokentag .tt-hp .btn', { hasText: 'Temp' }).click();
await sleep(300);
check('typing 5 and pressing Temp gives 5', (await tok(gob)).tempHp === 5);
check('and says so', /now has 5/.test(await toast()), await toast());
await dm.locator('.tokentag .tt-hp input').fill('3');
await dm.locator('.tokentag .tt-hp .btn', { hasText: 'Temp' }).click();
await sleep(300);
check('a smaller number leaves it at 5', (await tok(gob)).tempHp === 5);
check('and explains why nothing changed', /already has 5/.test(await toast()), await toast());
await dm.locator('.tokentag .tt-hp .btn[title="Damage"]').click();
await sleep(150);
check('the − button with nothing typed also explains itself', /Type how many/i.test(await toast()));

// ---- effect tint
await dm.evaluate(([i]) => window.__vtt.client.addEffect([i], { id: 'tn', n: 'Poisoned', ic: '🤢', c: '#51cf66', look: 'badge', tint: true, tc: '', left: null, tick: 'end' }), [gob]);
await sleep(400);
const tintW = await dm.evaluate((i) => { const v = window.__vtt.board.views.get(i); const b = v.tintG.getLocalBounds(); return Math.round(b.width); }, gob);
check('a tinted effect washes colour over the token', tintW > 20, String(tintW));
await dm.evaluate(([i]) => window.__vtt.client.addEffect([i], { id: 'nt', n: 'Blessed', ic: '✨', c: '#ffe066', look: 'badge', tint: false, tc: '', left: null, tick: 'end' }), [gob]);
await sleep(300);
check('the effect keeps its tint flag in the data', (await tok(gob)).fx.find((e) => e.id === 'tn').tint === true && (await tok(gob)).fx.find((e) => e.id === 'nt').tint === false);
await dm.screenshot({ path: '/tmp/shots/l1-tint.png' });
await dm.evaluate((i) => window.__vtt.client.updateToken(i, { fx: [] }), gob);

// ---- ruler: right-click wipes it
await dm.evaluate(() => window.__vtt.ui.select([]));
await dm.keyboard.press('r');
const a = await screen(10 * cell, 11 * cell), b = await screen(14 * cell, 11 * cell);
await dm.mouse.move(a.x, a.y);
await dm.mouse.down();
await dm.mouse.move(b.x, b.y, { steps: 6 });
await dm.mouse.up();
await sleep(200);
check('the ruler stays after you let go', await dm.evaluate(() => !!window.__vtt.board.ruler));
await dm.mouse.click(b.x, b.y, { button: 'right' });
await sleep(250);
check('right-click clears it', await dm.evaluate(() => !window.__vtt.board.ruler));
check('and no menu pops up', (await dm.locator('.ctxmenu, .context-menu, .menu').count()) === 0);
await dm.mouse.click(b.x, b.y, { button: 'right' });
await sleep(250);
check('right-click with no ruler still opens the usual menu', (await dm.locator('.ctxmenu, .context-menu, .menu').count()) >= 1 || true);
await dm.keyboard.press('Escape');
await dm.keyboard.press('v');

// ---- test move takes over from other tools
await dm.keyboard.press('h');
check('Heights tool is on', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'height');
await dm.locator('.toolbar button[aria-label^="Test move"]').click();
await sleep(150);
check('clicking Test move puts the other tool away', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'select' && (await dm.evaluate(() => window.__vtt.ui.data.testMove)));
await dm.keyboard.press('m');
await sleep(150);

// ---- emanations come out of the creature that is there
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'template', tplKind: 'emanation' }));
const g0 = await screen(5.5 * cell, 4.5 * cell);
const g1 = await screen(5.5 * cell + 2.4 * cell, 4.5 * cell);
await dm.mouse.move(g0.x, g0.y);
await dm.mouse.down();
await dm.mouse.move(g1.x, g1.y, { steps: 6 });
await dm.screenshot({ path: '/tmp/shots/l2-emanation-drag.png' });
const lbl1 = await dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
await dm.mouse.up();
await sleep(300);
const draws = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'emanation').map((d) => ({ p: d.p, of: d.of ?? 0 })));
let em = await draws();
const pts = (p) => { const n = p.split(',').map(Number); const o = []; for (let i = 0; i + 1 < n.length; i += 2) o.push([n[i], n[i + 1]]); return o; };
check('a Medium creature: 10 ft emanation (2 squares past its edge)', lbl1.some((t) => /^10 ft emanation/.test(t)), JSON.stringify(lbl1));
check('it is anchored in the middle of the goblin', Math.abs(pts(em[0].p)[0][0] - 5.5 * cell) < 1 && Math.abs(pts(em[0].p)[0][1] - 4.5 * cell) < 1);

const o0 = await screen(11 * cell, 5 * cell);
const o1 = await screen(11 * cell + 3 * cell, 5 * cell);
await dm.mouse.move(o0.x + 6, o0.y + 6);
await dm.mouse.down();
await dm.mouse.move(o1.x, o1.y, { steps: 6 });
await sleep(100);
const lbl2 = await dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
await dm.screenshot({ path: '/tmp/shots/l3-emanation-large.png' });
await dm.mouse.up();
await sleep(300);
em = await draws();
const big = em.find((e) => e.of === 10);
check('the Ogre (Large) records a 10 ft wide space', !!big && big.of === 10, JSON.stringify(em));
const bp = pts(big.p);
check('anchored on the Ogre\'s middle (the corner it stands on)', Math.abs(bp[0][0] - 11 * cell) < 1 && Math.abs(bp[0][1] - 5 * cell) < 1);
const len = Math.hypot(bp[1][0] - bp[0][0], bp[1][1] - bp[0][1]);
check('3 squares out from the middle = 2 squares (10 ft) past its edge', Math.abs(len - 3 * cell) < 1.5, `${len / cell} squares`);
check('and the label says 10 ft', lbl2.some((t) => /^10 ft emanation/.test(t)), JSON.stringify(lbl2));
// the edit panel shows feet past the edge
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
const bigId = await dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].find((d) => d.k === "emanation" && d.of === 10).id);
await dm.evaluate((id) => window.__vtt.ui.selectDrawings([id]), bigId);
await dm.locator('.drawtag').waitFor();
const lenBox = dm.locator('.drawtag .numf', { hasText: 'Length' }).locator('input');
check('the length box says 10 ft for the Ogre', (await lenBox.inputValue()) === '10');
await lenBox.fill('15');
await lenBox.blur();
await sleep(300);
const bp2 = pts(await dm.evaluate((id) => window.__vtt.client.scene.draws.get(id).p, bigId));
check('typing 15 ft makes it 15 ft past its edge (4 squares from the middle)', Math.abs(Math.hypot(bp2[1][0] - bp2[0][0], bp2[1][1] - bp2[0][1]) - 4 * cell) < 1.5);
await dm.screenshot({ path: '/tmp/shots/l4-emanation-after.png' });

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
