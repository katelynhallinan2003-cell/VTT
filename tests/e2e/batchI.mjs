// Round 4b: the initiative strip and pop-up, remembered bonuses, secret lines, and effects on tokens.
import { launch, watch, sleep } from './lib.mjs';
const BASE = (process.env.BASE || 'http://127.0.0.1:4174/') + '?demo';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const { browser, context } = await launch();
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.evaluate(() => localStorage.clear());
await dm.reload();
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('I');
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
const hero = await add({ x: 3.5 * cell, y: 4.5 * cell, name: 'Aria', ownerUid: pid, initBonus: 3 });
const gob = await add({ x: 6.5 * cell, y: 4.5 * cell, name: 'Goblin' });
const ogre = await add({ x: 9.5 * cell, y: 4.5 * cell, name: 'Ogre', size: 2 });
const sneak = await add({ x: 12.5 * cell, y: 4.5 * cell, name: 'Assassin', hidden: true });
await sleep(500);
const front = async (p) => { await p.bringToFront(); await sleep(150); };

// ---- opening it
check('there is an Initiative button in the left menu', (await dm.locator('.toolbar button[aria-label^="Initiative"]').count()) === 1);
check('players do not get one', (await pl.locator('.toolbar button[aria-label^="Initiative"]').count()) === 0);
await dm.keyboard.press('i');
await dm.waitForSelector('.initpop');
check('the I key opens the pop-up', true);
await dm.keyboard.press('i');
await sleep(150);
check('and closes it again', (await dm.locator('.initpop').count()) === 0);
await dm.locator('.toolbar button[aria-label^="Initiative"]').click();
await dm.waitForSelector('.initpop .roll-row');

// ---- bonuses: remembered per token, added to the d20
const rowOf = (n) => dm.locator('.roll-row', { hasText: n });
check("the hero's bonus (+3, set when the token was made) is already filled in", (await rowOf('Aria').locator('.roll-bonus').inputValue()) === '+3');
await rowOf('Aria').locator('.roll-in').fill('11');
check('the total is the d20 plus the bonus', (await rowOf('Aria').locator('.roll-total').innerText()) === '14');
await rowOf('Goblin').locator('.roll-bonus').fill('+2');
await rowOf('Goblin').locator('.roll-bonus').press('Enter');
await sleep(300);
check('typing a bonus remembers it on the token', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).initBonus, gob)) === 2);
await rowOf('Goblin').locator('.roll-in').fill('15');
check('and the total follows', (await rowOf('Goblin').locator('.roll-total').innerText()) === '17');
await rowOf('Ogre').locator('.roll-bonus').fill('-1');
await rowOf('Ogre').locator('.roll-bonus').press('Enter');
await rowOf('Assassin').locator('.roll-in').fill('18');
await dm.getByRole('button', { name: /Roll all empty/ }).click();
await sleep(200);
const ogreDie = Number(await rowOf('Ogre').locator('.roll-in').inputValue());
const ogreTot = Number(await rowOf('Ogre').locator('.roll-total').innerText());
check('"Roll all empty" rolls the digital dice with the bonus added', ogreDie >= 1 && ogreDie <= 20 && ogreTot === ogreDie - 1, `${ogreDie} -> ${ogreTot}`);
check('and leaves rolls that were typed alone', (await rowOf('Aria').locator('.roll-in').inputValue()) === '11');
check('the column headings explain the boxes', /bonus/i.test(await dm.locator('.roll-cols').innerText()));
await dm.screenshot({ path: '/tmp/shots/110-init-roll.png' });
await dm.locator('.initpop .btn.primary', { hasText: /Add \d+ to the order/ }).click();
await sleep(500);
const ent = await dm.evaluate(() => Object.fromEntries(window.__vtt.client.scene.init.entries.map((e) => [e.n, e.i])));
check('the order uses d20 plus bonus', ent.Aria === 14 && ent.Goblin === 17 && ent.Assassin === 18 && ent.Ogre === ogreTot, JSON.stringify(ent));
check('and moves to the Order tab', (await dm.locator('.initpop-tabs .on').innerText()).startsWith('Order'));

// ---- a roll later remembers the bonus
await dm.locator('.initpop-tabs button', { hasText: 'Roll' }).click();
check('the bonus is still there the next time', (await rowOf('Goblin').locator('.roll-bonus').inputValue()) === '+2');
check('tokens already in the order are not ticked again', (await rowOf('Goblin').locator('input[type=checkbox]').isChecked()) === false);

// ---- something else, kept secret
await dm.locator('.free-name').fill('Lair action');
await dm.locator('.initpop input[aria-label="Its initiative"]').fill('20');
await dm.locator('.initpop .toggle', { hasText: 'Hide from players' }).locator('input').check();
await dm.locator('.initpop .row .btn.small', { hasText: /^Add$/ }).click();
await sleep(400);
const lair = await dm.evaluate(() => window.__vtt.client.scene.init.entries.find((e) => e.n === 'Lair action'));
check('a lair action can be added as a DM-only line', !!lair && lair.h === true && lair.i === 20);
check('hidden tokens are still in the list as secret lines', (await dm.locator('.init-row', { hasText: 'Lair action' }).count()) === 1);
await dm.locator('.initpop .toggle', { hasText: 'Show to players' }).locator('input').check();
await sleep(500);

// ---- the strip across the top middle
const bar = await dm.locator('.initbar').boundingBox();
const vw = 1400;
const strip = await dm.locator('.initstrip').boundingBox();
// (on the top row beside the top bar when there is room there, or else in a row of its own just under it)
check('the order shows as little boxes across the top', (await dm.locator('.initstrip.top .ibox').count()) === 5 && strip.y < 140);
check('roughly in the middle of the screen', Math.abs(strip.x + strip.width / 2 - vw / 2) < 120, `centre ${Math.round(strip.x + strip.width / 2)}`);
check('players see the boxes too, without the secret line', (await pl.locator('.initstrip .ibox').count()) === 3 && !(await pl.locator('.initstrip').innerText()).includes('Lair'));
check('the DM sees the secret one marked', (await dm.locator('.ibox.secret').count()) >= 1);
check('the first line to be rolled keeps the turn', (await dm.locator('.ibox.turn .ibox-name').innerText()) === 'Assassin');
await dm.screenshot({ path: '/tmp/shots/111-init-top-dm.png' });
await front(pl);
await pl.screenshot({ path: '/tmp/shots/112-init-top-player.png' });
await front(dm);

// the old right-edge list is a setting
await dm.getByRole('button', { name: 'Settings' }).click();
await dm.locator('.modal .tabs button', { hasText: 'You' }).click();
await dm.locator('.seg button', { hasText: 'Right edge' }).click();
await dm.keyboard.press('Escape');
await sleep(200);
check('the settings can move the order to the right edge', (await dm.locator('.initstrip.side').count()) === 1 && (await dm.locator('.initbar').count()) === 0);
await dm.screenshot({ path: '/tmp/shots/113-init-side.png' });
await dm.getByRole('button', { name: 'Settings' }).click();
await dm.locator('.modal .tabs button', { hasText: 'You' }).click();
await dm.locator('.seg button', { hasText: 'Across the top' }).click();
await dm.keyboard.press('Escape');
await sleep(200);
check('and back', (await dm.locator('.initstrip.top').count()) === 1);

// ---- effects
await dm.locator('.initpop button[aria-label="Close initiative"]').click();
await dm.evaluate((i) => window.__vtt.ui.select([i]), gob);
await sleep(200);
await dm.locator('.tokentag button', { hasText: /^Effects/ }).click();
await dm.waitForSelector('.fwin .fx-search');
await dm.locator('.fx-search').click();
check('the effects window offers the 5e conditions', (await dm.locator('.fx-opt', { hasText: 'Poisoned' }).count()) === 1 && (await dm.locator('.fx-opt', { hasText: 'Frightened' }).count()) === 1);
await dm.locator('.fx-opt', { hasText: 'Poisoned' }).click();
check('picking one fills the box', (await dm.locator('.fx-search').inputValue()) === 'Poisoned');
await dm.locator('.fwin .seg button', { hasText: 'Glow' }).click();
await dm.locator('.fwin input[aria-label="Rounds"]').fill('2');
await dm.locator('.fwin .seg button', { hasText: 'End of its turn' }).click();
await dm.locator('.fwin-foot .btn.primary', { hasText: /^Add/ }).click();
await sleep(300);
let fx = await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx, gob);
check('Poisoned is on the goblin for 2 rounds, ending with its turn', fx.length === 1 && fx[0].n === 'Poisoned' && fx[0].left === 2 && fx[0].tick === 'end' && fx[0].look === 'halo');
// a made-up one with no timer
await dm.locator('.fx-tabs button', { hasText: 'Make your own' }).click();
await dm.locator('.fx-form input[type=text]').first().fill("Hag's curse");
await dm.locator('.fx-pic-btn').click();
await dm.locator('.fx-pop .fx-pic').nth(0).click();
await dm.locator('.fwin .fx-colour input[type=color]').fill('#9c36b5');
await dm.locator('.fwin .seg button', { hasText: 'Orbit' }).click();
await dm.locator('.fwin .seg button', { hasText: 'Until I remove it' }).click();
await dm.locator('.fwin-foot .btn.primary', { hasText: /^Add/ }).click();
await sleep(300);
fx = await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx, gob);
check('a custom, named effect can be made, with no timer', fx.length === 2 && fx[1].n === "Hag's curse" && fx[1].left === null && fx[1].look === 'orbit' && fx[1].c === '#9c36b5');
check('the window lists what is on the token', (await dm.locator('.fx-line').count()) === 2);
await dm.locator('.fwin-head .icon-btn').click();
// the hero gets a badge effect
await dm.evaluate((i) => window.__vtt.ui.select([i]), hero);
await dm.locator('.tokentag button', { hasText: /^Effects/ }).click();
await dm.locator('.fx-search').click();
await dm.locator('.fx-opt', { hasText: 'Blessed' }).click();
await dm.locator('.fwin .seg button', { hasText: 'A number of rounds' }).click();
await dm.locator('.fwin input[aria-label="Rounds"]').fill('3');
await dm.locator('.fwin .seg button', { hasText: 'Every round' }).click();
await dm.locator('.fwin-foot .btn.primary', { hasText: /^Add/ }).click();
await dm.locator('.fx-search').click();
await dm.locator('.fx-opt', { hasText: 'Concentrating' }).click();
await dm.locator('.fwin .seg button', { hasText: 'Until I remove it' }).click();
await dm.locator('.fwin .seg button', { hasText: 'Badge' }).click();
await dm.locator('.fwin-foot .btn.primary', { hasText: /^Add/ }).click();
await sleep(300);
await dm.locator('.fwin-head .icon-btn').click();
await dm.evaluate(() => { window.__vtt.ui.select([]); window.__vtt.board.fit(); });
await sleep(600);
await dm.screenshot({ path: '/tmp/shots/114-effects-board.png' });
await front(pl);
await sleep(300);
check('players receive the effects too', (await pl.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx.length, gob)) === 2);
check('and see them on the boxes', (await pl.locator('.ibox', { hasText: 'Goblin' }).locator('.fxi').count()) === 2);
await pl.evaluate(() => window.__vtt.board.fit());
await sleep(400);
await pl.screenshot({ path: '/tmp/shots/115-effects-player.png' });
await front(dm);

// ---- effects count down with the turns
await dm.locator('.toolbar button[aria-label^="Initiative"]').click();
await dm.locator('.initpop-tabs button', { hasText: /^Order/ }).click();
// make the turn the goblin's, then step through two of its turns
const curTurn = () => dm.evaluate(() => { const s = window.__vtt.client.scene.init; return s.entries.find((e) => e.id === s.turn)?.n; });
let guard = 0;
while ((await curTurn()) !== 'Goblin' && guard++ < 8) { await dm.locator('.initpop').getByRole('button', { name: /Next turn/ }).click(); await sleep(250); }
check('stepped to the goblin', (await curTurn()) === 'Goblin');
const left = () => dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx.map((e) => `${e.n}:${e.left ?? '-'}`).join(), gob);
check('nothing has ticked yet', (await left()) === "Poisoned:2,Hag's curse:-", await left());
await dm.locator('.initpop').getByRole('button', { name: /Next turn/ }).click(); // goblin's turn ends
await sleep(400);
check('Poisoned counts down when its turn ends', (await left()) === "Poisoned:1,Hag's curse:-", await left());
guard = 0;
while ((await curTurn()) !== 'Goblin' && guard++ < 8) { await dm.locator('.initpop').getByRole('button', { name: /Next turn/ }).click(); await sleep(250); }
await dm.locator('.initpop').getByRole('button', { name: /Next turn/ }).click();
await sleep(500);
check('and goes away by itself after its second turn', (await left()) === "Hag's curse:-", await left());
check('the DM is told when an effect ends', (await dm.locator('.toast', { hasText: 'Poisoned ended on Goblin' }).count()) >= 1);
const hero_fx = await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx.map((e) => `${e.n}:${e.left ?? '-'}`).join(), hero);
check('Blessed (every round) counted down once per round', hero_fx === 'Blessed:2,Concentrating:-' || hero_fx === 'Blessed:1,Concentrating:-', hero_fx);
// undo end combat
await dm.locator('.initpop-tabs button', { hasText: /^Order/ }).click();
await dm.getByRole('button', { name: 'End combat' }).click();
await sleep(300);
check('End combat clears with no confirmation', (await dm.evaluate(() => window.__vtt.client.scene.init.entries.length)) === 0);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and Ctrl+Z brings the order back', (await dm.evaluate(() => window.__vtt.client.scene.init.entries.length)) === 5);

// ---- the quick way to nudge a timer
await dm.evaluate((i) => window.__vtt.client.addEffect([i], { id: 'zz', n: 'Slowed', ic: '🐌', c: '#b197fc', look: 'badge', left: 3, tick: 'end' }), ogre);
await sleep(300);
await dm.evaluate((i) => window.__vtt.ui.select([i]), ogre);
await dm.locator('.tokentag button', { hasText: /^Effects/ }).click();
await dm.locator('.fx-line .icon-btn[title^="One more"]').click();
await sleep(300);
check('+ adds a round to a timed effect', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx[0].left, ogre)) === 4);
await dm.locator('.fx-line .icon-btn[title^="Take this effect off"]').click();
await sleep(300);
check('and ✕ takes it off', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).fx.length, ogre)) === 0);
await dm.keyboard.press('Escape');

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
