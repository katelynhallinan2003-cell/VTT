// Round 7k: torches are not in the Tokens list (they have a folded Lights list) and a player cannot take one.
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
await dm.getByPlaceholder('New table name').fill('Z11');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const sid1 = await dm.evaluate(() => window.__vtt.client.viewSceneId);



// ---- a torch and a guard on the scene
const torch = await dm.evaluate(() => window.__vtt.client.addToken({ x: 175, y: 175, name: 'Torch', size: 0.5, shape: 'none', label: 'dm', light: { b: 20, d: 20, c: '#ffcc66' } }));
const guard = await dm.evaluate(() => window.__vtt.client.addToken({ x: 315, y: 175, name: 'Guard', size: 1 }));
await sleep(500);
await dm.keyboard.press('Escape');
await dm.getByRole('button', { name: 'Tokens', exact: true }).click();
await sleep(300);
const rows = () => dm.locator('.tok-list li .tok-name').allInnerTexts();
let r = await rows();
check('the Tokens list shows the guard but not the torch', r.length === 1 && /Guard/.test(r[0]), JSON.stringify(r));
check('the search counts only real tokens', (await dm.getByPlaceholder(/Search 1 token/).count()) === 1);
const lightsBtn = dm.getByRole('button', { name: /Lights \(1\)/ });
check('lights have their own folded list', (await lightsBtn.count()) === 1 && (await lightsBtn.getAttribute('aria-expanded')) === 'false');
await lightsBtn.click();
await sleep(200);
r = await rows();
check('opening it lists the torch', r.length === 2 && r.some((t) => /Torch/.test(t)), JSON.stringify(r));
await dm.screenshot({ path: '/tmp/shots/z11-lights.png' });
await dm.getByPlaceholder(/Search 1 token/).fill('torch');
await sleep(200);
r = await rows();
check('a search that matches a light shows it', r.length === 1 && /Torch/.test(r[0]), JSON.stringify(r));
await dm.getByPlaceholder(/Search 1 token/).fill('');

// ---- a player cannot take the torch
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(1200);
if (!(await pl.getByText('Pick your character').count())) await pl.getByRole('button', { name: 'My token' }).click();
await pl.getByText('Pick your character').waitFor();
const offered = await pl.locator('.modal .lib-item .lib-name').allInnerTexts();
check('the player is offered the guard only', offered.length === 1 && offered[0] === 'Guard', JSON.stringify(offered));
check('the player cannot claim the torch', (await pl.evaluate((id) => window.__vtt.client.canDo('claim', window.__vtt.client.scene.tokens.get(id)), torch)) === false);
check('but can claim the guard', (await pl.evaluate((id) => window.__vtt.client.canDo('claim', window.__vtt.client.scene.tokens.get(id)), guard)) === true);
await pl.keyboard.press('Escape');
await pl.evaluate((id) => window.__vtt.ui.select([id]), torch);
await sleep(300);
check('selecting the torch offers no "Take control"', (await pl.getByRole('button', { name: 'Take control' }).count()) === 0);

// ---- the DM has no "Give to" for a torch
await dm.evaluate((id) => window.__vtt.ui.select([id]), torch);
await sleep(200);
const pt = await dm.evaluate((id) => { const v = window.__vtt.board.views.get(id); return window.__vtt.board.worldToScreen({ x: v.display.x, y: v.display.y }); }, torch);
await dm.mouse.click(pt.x, pt.y, { button: 'right' });
await sleep(300);
const menu = await dm.locator('.ctx').allInnerTexts();
check('the DM menu for a torch has no "Give to" entries', menu.length === 1 && !/Give to/.test(menu[0]) && /Hide marker from players|Show marker to players/.test(menu[0]), menu.join('|').slice(0, 200));
await dm.keyboard.press('Escape');
const gp = await dm.evaluate((id) => window.__vtt.board.worldToScreen({ x: window.__vtt.board.views.get(id).display.x, y: window.__vtt.board.views.get(id).display.y }), guard);
await dm.mouse.click(gp.x, gp.y, { button: 'right' });
await sleep(300);
check('and the guard still has them', /Give to Aria/.test((await dm.locator('.ctx').allInnerTexts()).join('|')));

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
