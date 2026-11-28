// Round 7e: three kinds of ground in the fog, lights everyone can see, darkvision toggle, own lights, the Sight and lights tab.
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
await dm.getByPlaceholder('New table name').fill('Z4');
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
const fogAt = (p) => dm.evaluate((q) => window.__vtt.board.fogMask.fogAt(q), p);
const alphaAt = (p) => dm.evaluate((q) => {
  const m = window.__vtt.board.fogMask; const x = Math.floor((q.x - m.origin.x) * m.scale), y = Math.floor((q.y - m.origin.y) * m.scale);
  return m.canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
}, p);
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(300);

// ---- the Scene panel offers the grey setting once memory is on
const openScene = async () => { if (!(await dm.locator('.sect-head').count())) await dm.locator('.rail-tab', { hasText: 'Scene' }).click(); await dm.locator('.sect-head').first().waitFor(); };
await openScene();
await dm.evaluate(() => window.__vtt.client.resetFog('hidden'));
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { vision: true, explore: true } }));
await sleep(400);
if (!(await dm.getByText('Remember what they have seen').first().isVisible().catch(() => false))) await dm.locator('.sect-head', { hasText: 'Fog of war' }).first().click();
check('the fog panel says "Remember what they have seen"', (await dm.getByText('Remember what they have seen').count()) >= 1);
check('and offers to grey out what cannot be seen now (on by default)', (await dm.getByText('Grey out what they cannot see right now').count()) >= 1 && (await dm.evaluate(() => window.__vtt.client.scene.meta.fog.dim)) === true);

// ---- a scout walks along; where it has been turns grey, where it is stays clear, the rest stays black
const scout = await dm.evaluate(async (p) => window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Scout', size: 1, sight: 30, ownerUid: 'someone' }), C(4, 6));
await sleep(600);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(300);
await dm.evaluate(([id, p]) => window.__vtt.client.moveTokens([{ id, x: p.x, y: p.y }]), [scout, C(12, 6)]);
await sleep(500);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(500);
const oldSpot = C(4, 6), newSpot = C(12, 6), farSpot = C(12, 15);
const fOld = await fogAt(oldSpot), fFar = await fogAt(farSpot);
check('where it started is now seen ground under fog', fOld.fog && fOld.seen, JSON.stringify(fOld));
check('ground it never saw is fog that was never seen', fFar.fog && !fFar.seen, JSON.stringify(fFar));
const aOld = await alphaAt(oldSpot), aFar = await alphaAt(farSpot);
check('seen ground is drawn lighter than unseen ground', aFar === 255 && aOld > 90 && aOld < 135, `${aOld} vs ${aFar}`);
check('ops written for it are the grey kind', await dm.evaluate(() => [...window.__vtt.client.scene.fogOps.values()].every((o) => o.m === 'x')));

// ---- as a player: the grey ground hides what stands in it, and the clear ground does not
const gob = await dm.evaluate(async (p) => window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Goblin', size: 1 }), C(4, 6));
const gob2 = await dm.evaluate(async (p) => window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Goblin B', size: 1 }), C(13, 6));
await sleep(500);
const hideState = (id) => dm.evaluate((i) => ({ out: window.__vtt.board.outOfSight.has(i), vis: window.__vtt.board.views.get(i)?.container.visible }), id);
check('the DM sees everything as before', (await hideState(gob)).out === false);
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: true }));
await sleep(500);
const h1 = await hideState(gob), h2 = await hideState(gob2), h3 = await hideState(scout);
check('a monster standing on remembered ground, out of sight, is hidden', h1.out === true && h1.vis === false, JSON.stringify(h1));
check('one in plain view is shown', h2.out === false && h2.vis !== false, JSON.stringify(h2));
check('and a token the party owns is never hidden', h3.out === false);
check('it cannot be picked on the board either', await dm.evaluate((p) => window.__vtt.board.hitToken(p) === null, C(4, 6)));
await dm.screenshot({ path: '/tmp/shots/z4-grey.png' });
// the scout comes back: the goblin is seen again
await dm.evaluate(([id, p]) => window.__vtt.client.moveTokens([{ id, x: p.x, y: p.y }]), [scout, C(6, 6)]);
await sleep(700);
check('once the scout looks again it is shown again', (await hideState(gob)).out === false);
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: false }));

// ---- turning the grey off keeps everything clear (plain reveals)
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { dim: false } }));
await sleep(300);
await dm.evaluate(([id, p]) => window.__vtt.client.moveTokens([{ id, x: p.x, y: p.y }]), [scout, C(12, 14)]);
await sleep(500);
await dm.evaluate(() => window.__vtt.client.exploreNow());
await sleep(400);
const fNew = await fogAt(C(12, 14));
check('with the grey off a newly seen place is simply clear', fNew.fog === false, JSON.stringify(fNew));
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { dim: true } }));

// ---- a light is a small flame everyone can see
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: false } }));
const lamp = await dm.evaluate(async (p) => window.__vtt.client.addToken({ x: p.x, y: p.y, name: 'Torch', size: 0.5, shape: 'none', label: 'dm', light: { b: 20, d: 20, c: '#ffc27a' } }), C(9, 9));
await sleep(500);
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: true }));
await sleep(400);
check('players see the flame of a placed light', await dm.evaluate((id) => window.__vtt.board.views.get(id).initial.visible === true, lamp));
await dm.screenshot({ path: '/tmp/shots/z4-flame.png' });
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: false }));
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { hidden: true }), lamp);
await sleep(300);
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: true }));
await sleep(300);
check('a hidden light stays hidden from players', await dm.evaluate((id) => !window.__vtt.board.views.has(id), lamp));
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: false }));
await dm.evaluate((id) => window.__vtt.client.updateTokens([id], { hidden: false }), lamp);

// ---- the token editor: Sight and lights has its own tab
await dm.evaluate((id) => window.__vtt.ui.select([id]), scout);
await sleep(300);
await dm.getByRole('button', { name: 'Edit', exact: true }).click();
await dm.locator('.modal').waitFor();
await sleep(300);
check('the editor has a Token tab and a Sight and lights tab', (await dm.locator('.modal .seg button', { hasText: /^Token$/ }).count()) === 1 && (await dm.locator('.modal .seg button', { hasText: 'Sight and lights' }).count()) === 1);
await dm.locator('.modal .seg button', { hasText: 'Sight and lights' }).click();
await sleep(200);
check('there, sight, darkvision and lights are together', (await dm.locator('.modal h4', { hasText: 'Sight' }).count()) >= 1 && (await dm.locator('.modal h4', { hasText: 'Darkvision' }).count()) === 1 && (await dm.locator('.modal h4', { hasText: 'Lights' }).count()) === 1);
check('darkvision starts off, with no distance asked for', (await dm.getByText('Darkvision reaches (feet)').count()) === 0);
await dm.locator('.modal').getByText('Has darkvision').click();
await sleep(200);
check('switching it on asks how far', (await dm.getByText('Darkvision reaches (feet)').count()) === 1);
await dm.locator('.modal .btn', { hasText: /^90 ft$/ }).first().click();
await dm.locator('.modal').getByText('Gives off light').click();
await sleep(200);
check('a light can be switched on', (await dm.getByText('Make your own').count()) >= 1);
await dm.locator('.modal label.field-label', { hasText: 'Bright' }).locator('input').fill('25');
await dm.locator('.modal label.field-label', { hasText: 'then dim' }).locator('input').fill('35');
await dm.locator('.modal input[type=text][placeholder^="Name, e.g."]').fill('Everburning torch');
await dm.locator('.modal .btn', { hasText: 'Save this light' }).click();
await sleep(300);
check('a made-up light is kept under "Your lights"', (await dm.getByText('Your lights').count()) === 1 && (await dm.locator('.modal .btn', { hasText: 'Everburning torch' }).count()) === 1);
await dm.getByRole('button', { name: 'Save', exact: true }).click();
await sleep(500);
const sv = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { dv: t.dv, light: t.light }; }, scout);
check('saving keeps darkvision 90 and the 25 + 35 light', sv.dv === 90 && sv.light?.b === 25 && sv.light?.d === 35, JSON.stringify(sv));
const stored = await dm.evaluate(() => JSON.parse(localStorage.getItem('vtt-custom-lights') || '[]'));
check('the made-up light is remembered in this browser', stored.length === 1 && stored[0].name === 'Everburning torch' && stored[0].light.b === 25);

// ---- and it can be placed from the Scene panel
await openScene();
let opt = await dm.locator('select option', { hasText: 'Everburning torch' }).count();
if (!opt) { await dm.locator('.sect-head', { hasText: 'Light and darkness' }).click(); await sleep(200); opt = await dm.locator('select option', { hasText: 'Everburning torch' }).count(); }
check('the Scene panel lists it among the lights to place', opt === 1);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
