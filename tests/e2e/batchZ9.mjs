// Round 7i: saved tokens for the DM, characters for players, and tokens that keep their hit points between scenes.
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
await dm.getByPlaceholder('New table name').fill('Z9');
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

// ---- the DM saves a token with all its settings
const ogre = await dm.evaluate(() => window.__vtt.client.addToken({ x: 315, y: 315, name: 'Ogre', size: 2, sight: 60, hp: 59, maxHp: 59, light: { b: 20, d: 20, c: '#ffc27a' } }));
await sleep(400);
await dm.evaluate((id) => window.__vtt.ui.select([id]), ogre);
await sleep(300);
await dm.getByRole('button', { name: 'Save to library' }).click();
await sleep(500);
check('Save to library keeps it', (await dm.evaluate(() => window.__vtt.client.tokenLib.map((e) => e.name))).join() === 'Ogre');
await dm.getByRole('button', { name: 'Library', exact: true }).click();
await dm.locator('.modal .tabs button', { hasText: 'Saved tokens' }).click();
await sleep(300);
check('the Library has a Saved tokens tab listing it', (await dm.locator('.modal [data-saved]').count()) === 1 && (await dm.locator('.modal .lib-name', { hasText: 'Ogre' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z9-saved.png' });
await dm.locator('.modal [data-saved] .btn', { hasText: 'Add to board' }).click();
await sleep(500);
const ogres = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].filter((t) => t.name === 'Ogre').map((t) => ({ id: t.id, size: t.size, sight: t.sight, hp: t.hp, maxHp: t.maxHp, light: t.light })));
check('Add to board makes another with the same settings and full health', ogres.length === 2 && ogres.every((o) => o.size === 2 && o.sight === 60 && o.maxHp === 59) && ogres.some((o) => o.id !== ogre && o.hp === 59 && o.light?.b === 20), JSON.stringify(ogres));
check('the library closes and the new token is selected', (await dm.locator('.modal').count()) === 0 && (await dm.evaluate(() => window.__vtt.ui.data.selection.size)) === 1);

// ---- a player joins, makes a token and keeps it as a character
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(800);
await pl.keyboard.press('Escape');
const aria = await pl.evaluate(() => window.__vtt.client.addToken({ x: 175, y: 175, name: 'Aria', size: 1 }));
await sleep(600);
await pl.evaluate((id) => window.__vtt.ui.select([id]), aria);
await sleep(300);
check('the player gets a Save character button on their own token', (await pl.getByRole('button', { name: 'Save character' }).count()) === 1);
check('and the DM does not get one for it that says character', (await pl.getByRole('button', { name: 'Save to library' }).count()) === 0);
await pl.getByRole('button', { name: 'Save character' }).click();
await sleep(700);
const cid = await pl.evaluate((id) => window.__vtt.client.scene.tokens.get(id).cid, aria);
check('it is saved and the token knows which character it is', !!cid && (await pl.evaluate(() => window.__vtt.client.tokenLib.length)) === 1);
check('the button now says Update saved', (await pl.getByRole('button', { name: 'Update saved' }).count()) === 1);
await pl.getByRole('button', { name: 'My token' }).click();
await pl.locator('.modal').waitFor();
await sleep(300);
check('My token lists it under Your characters, already here', (await pl.locator('.modal [data-saved] .btn', { hasText: 'Here already' }).count()) === 1);
await pl.screenshot({ path: '/tmp/shots/z9-claim.png' });
await pl.keyboard.press('Escape');
await pl.locator('.modal').waitFor({ state: 'detached' }).catch(() => undefined);

// ---- the DM hurts her, then moves the table to another scene: she comes along as she is
await dm.bringToFront();
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { hp: 11, maxHp: 40 }), aria);
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { fx: [{ id: 'fx1', n: 'Poisoned', ic: '', c: '#51cf66', look: 'badge', tint: false }] }), aria);
await sleep(900);
const sid2 = await dm.evaluate(() => window.__vtt.client.createScene({ name: 'Camp' }));
await sleep(500);
await dm.locator('select.folder-select').selectOption('all').catch(() => undefined);
await dm.locator('select.scene-select').selectOption(sid2);
await sleep(600);
check('the DM is looking at the camp', (await dm.evaluate(() => window.__vtt.client.viewSceneId)) !== sid1);
await dm.getByRole('button', { name: 'Summon players' }).first().click();
await sleep(1500);
const camp = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].map((t) => ({ name: t.name, owner: !!t.ownerUid, hp: t.hp, max: t.maxHp, fx: t.fx.map((e) => e.n), cid: t.cid })));
check('Aria is in the camp with her hit points, conditions and character link', camp.length === 1 && camp[0].name === 'Aria' && camp[0].owner && camp[0].hp === 11 && camp[0].max === 40 && camp[0].fx[0] === 'Poisoned' && camp[0].cid === cid, JSON.stringify(camp));
check('the player is there too and controls her', (await pl.evaluate(() => window.__vtt.client.myTokens().map((t) => t.name).join())) === 'Aria');
await pl.screenshot({ path: '/tmp/shots/z9-camp-player.png' });

// ---- she leaves the scene and brings herself back from her library: the DM gives her the hit points she had
const campId = await pl.evaluate(() => window.__vtt.client.myTokens()[0].id);
await pl.evaluate((id) => window.__vtt.client.removeTokens([id]), campId);
await sleep(700);
check('she is off the map', (await pl.evaluate(() => window.__vtt.client.myTokens().length)) === 0);
await pl.getByRole('button', { name: 'My token' }).click();
await pl.locator('.modal [data-saved] .btn', { hasText: 'Bring here' }).click();
await sleep(2200);
const back = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].map((t) => ({ name: t.name, hp: t.hp, max: t.maxHp, fx: t.fx.map((e) => e.n) })));
check('she is back with her hit points and conditions', back.length === 1 && back[0].hp === 11 && back[0].max === 40 && back[0].fx[0] === 'Poisoned', JSON.stringify(back));
const pct = await pl.evaluate(() => window.__vtt.client.myTokens()[0]?.hpPct);
check('and the player sees her health as a percentage (28%)', pct === 28, String(pct));

// ---- the setting
await dm.getByRole('button', { name: 'Settings' }).click();
await dm.locator('.modal').waitFor();
check('Settings has the switch for bringing tokens along', (await dm.locator('.modal .toggle', { hasText: "Bring the players' tokens along" }).count()) === 1);
await dm.keyboard.press('Escape');

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
