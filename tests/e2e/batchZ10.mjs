// Round 7j: a returning player picks their name on the join screen and gets their characters (and token) back.
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
await dm.getByPlaceholder('New table name').fill('Z10');
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


// ---- Aria joins, makes a token and keeps it as a character
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
check('the first player sees no "played here before" list', (await pl.getByText('Played here before?').count()) === 0);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(800);
await pl.keyboard.press('Escape');
const aria = await pl.evaluate(() => window.__vtt.client.addToken({ x: 175, y: 175, name: 'Aria', size: 1 }));
await sleep(600);
await pl.evaluate((id) => window.__vtt.ui.select([id]), aria);
await sleep(300);
await pl.getByRole('button', { name: 'Save character' }).click();
await sleep(700);
const uid1 = await pl.evaluate(() => window.__vtt.client.uid);
check('the character is kept with the table, under her identity', (await pl.evaluate((t) => window.__vtt.client.libPath === `tables/${t}/chars/${window.__vtt.client.uid}`, tid)) && (await pl.evaluate(() => window.__vtt.client.tokenLib.length)) === 1);
// she leaves (this browser goes offline)
await pl.evaluate(() => window.__vtt.client.backend.update({ [`tables/${window.__vtt.client.tableId}/players/${window.__vtt.client.uid}/online`]: false }));
await sleep(300);
await pl.close();

// ---- a new browser: pick the old name
const pl2 = await context.newPage();
watch(pl2, 'pl2', errors);
await pl2.goto(`${BASE}#/t/${tid}`);
await pl2.getByText('Played here before?').waitFor();
check('the join screen lists Aria', (await pl2.locator('.chip', { hasText: 'Aria' }).count()) === 1);
await pl2.screenshot({ path: '/tmp/shots/z10-join.png' });
await pl2.locator('.chip', { hasText: 'Aria' }).click();
check('picking her fills in her name', (await pl2.getByPlaceholder('e.g. Aria').inputValue()) === 'Aria');
await pl2.getByRole('button', { name: 'Join table' }).click();
await pl2.waitForSelector('.board-host canvas');
await sleep(1200);
const uid2 = await pl2.evaluate(() => window.__vtt.client.uid);
check('it is a different browser identity', uid1 !== uid2);
check('her saved character is back', (await pl2.evaluate(() => window.__vtt.client.tokenLib.map((e) => e.name).join())) === 'Aria');
await sleep(1500);
const owner = await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id)?.ownerUid ?? null, aria);
check('the DM gave her old token to the new browser', owner === uid2, String(owner));
check('the table list has one Aria', (await dm.evaluate(() => [...window.__vtt.client.players.values()].filter((p) => p.name === 'Aria').length)) === 1);
await pl2.keyboard.press('Escape');
const mine = await pl2.evaluate(() => window.__vtt.client.myTokens().map((t) => t.name).join());
check('she controls her token again', mine === 'Aria', mine);

// ---- a stranger who does not pick a name starts with no characters
const pl3 = await context.newPage();
watch(pl3, 'pl3', errors);
await pl3.goto(`${BASE}#/t/${tid}`);
await pl3.getByPlaceholder('e.g. Aria').fill('Bo');
await pl3.getByRole('button', { name: 'Join table' }).click();
await pl3.waitForSelector('.board-host canvas');
await sleep(900);
check('a new player who picks no name has no characters', (await pl3.evaluate(() => window.__vtt.client.tokenLib.length)) === 0);

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
