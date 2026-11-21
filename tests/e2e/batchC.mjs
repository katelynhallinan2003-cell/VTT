// Initiative, hit points and fog sight, with a second browser tab as a player.
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
await dm.getByPlaceholder('New table name').fill('C');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.getByRole('button', { name: 'Create scene' }).waitFor();
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
// Aria's hero, a goblin, an ogre with hit points and a hidden assassin
const add = (partial) => dm.evaluate((p) => window.__vtt.client.addToken(p), partial);
const hero = await add({ x: 3.5 * cell, y: 3.5 * cell, name: 'Aria', ownerUid: pid });
const gob = await add({ x: 6.5 * cell, y: 3.5 * cell, name: 'Goblin', hp: 7, maxHp: 7 });
const ogre = await add({ x: 8.5 * cell, y: 6.5 * cell, name: 'Ogre', size: 2, hp: 59, maxHp: 59, hpShow: 'bar' });
const sneak = await add({ x: 10.5 * cell, y: 3.5 * cell, name: 'Assassin', hidden: true, hp: 20, maxHp: 20 });
await sleep(500);
await dm.evaluate(() => window.__vtt.board.fit());
await pl.evaluate(() => window.__vtt.board.fit());
await sleep(300);

// ---- hit points on the board
// a tab in the background does not run animation frames, so bring a tab forward before looking at what its board draws
const front = async (page) => { await page.bringToFront(); await sleep(150); };
const health = async (page, id) => { await front(page); return page.evaluate((i) => window.__vtt.board.views.get(i)?.health ?? null, id); };
let h = await health(dm, ogre);
check('the DM sees a full bar on a token with hit points', h && h.pct === 100 && h.bar === true);
check('and none on a token without any', (await health(dm, hero)) === null);
check('the player sees a bar on the token the DM chose to show', (await health(pl, ogre))?.bar === true);
check('the goblin shows nothing until it is hurt, then only colour', (await health(pl, gob))?.bar === false);
check('the hidden assassin does not reach the player', (await pl.evaluate((i) => window.__vtt.client.scene.tokens.has(i), sneak)) === false);

await dm.evaluate((i) => window.__vtt.ui.select([i]), ogre);
await sleep(200);
check('selecting the ogre shows hit point controls', (await dm.locator('.tt-hp').count()) === 1 && (await dm.locator('.tt-hpnum').innerText()).trim() === '59/59');
await dm.locator('.tt-hp input').fill('40');
await dm.locator('.tt-hp button[title="Damage"]').click();
await sleep(300);
check('damage lowers it', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)) === 19);
check('the player only gets a percentage', (await pl.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return [t.hp, t.hpPct]; }, ogre)).join() === ',32');
check('and the board shows it as bloodied', (await health(pl, ogre))?.pct === 32);
await dm.locator('.tt-hp input').fill('15');
await dm.locator('.tt-hp button[title="Damage"]').click();
await sleep(400);
check('near death at 4 of 59', (await health(pl, ogre))?.pct === 7, JSON.stringify([await health(pl, ogre), await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)]));
await dm.evaluate(() => { const c = window.__vtt.board; c.centerOn({ x: 8.5 * c.client.grid.cell, y: 5 * c.client.grid.cell }); });
await pl.evaluate(() => { const c = window.__vtt.board; c.centerOn({ x: 8.5 * c.client.grid.cell, y: 5 * c.client.grid.cell }); });
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/70-hp-dm.png' });
await pl.screenshot({ path: '/tmp/shots/71-hp-player.png' });
await dm.keyboard.press('Control+z');
await dm.keyboard.press('Control+z');
await sleep(300);
check('Ctrl+Z gives the hit points back', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)) === 59);

// the token editor
await dm.evaluate((i) => window.__vtt.ui.select([i]), gob);
await sleep(200);
await dm.keyboard.press('e');
await dm.waitForSelector('.modal');
await dm.locator('.modal input[placeholder="Max"]').fill('12');
await dm.locator('.modal select').filter({ hasText: 'Nothing at all' }).selectOption('off');
await dm.screenshot({ path: '/tmp/shots/72-token-editor-health.png' });
await dm.locator('.modal-foot .btn.primary').click();
await sleep(400);
const g = await dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return [t.hp, t.maxHp, t.hpShow, t.hpPct]; }, gob);
check('the editor sets max hit points and what players see', g.join() === '7,12,off,');
check('and hiding health from players clears what they receive', (await pl.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hpPct, gob)) === null);
await dm.evaluate((i) => window.__vtt.client.updateTokens([i], { hp: 12, hpShow: 'state' }), gob);
await sleep(300);

// ---- initiative
await dm.locator('.rail-tab', { hasText: 'Initiative' }).click();
check('the Initiative tab starts empty', (await dm.locator('.init-row').count()) === 0);
await dm.getByRole('button', { name: /Roll for initiative/ }).first().click();
await dm.waitForSelector('.roll-list');
check('the roll popup lists every token, party first', (await dm.locator('.roll-row').count()) === 4 && (await dm.locator('.roll-row').first().innerText()).includes('Aria'));
const rollIn = (name) => dm.locator('.roll-row', { hasText: name }).locator('.roll-in');
await rollIn('Aria').fill('14');
await rollIn('Aria').press('Enter');
check('Enter jumps to the next box', await dm.evaluate(() => document.activeElement === document.querySelectorAll('.roll-in')[1]));
await rollIn('Goblin').fill('17');
await rollIn('Ogre').fill('9');
await dm.locator('.roll-row', { hasText: 'Assassin' }).locator('button[title^="Roll a d20"]').click();
const rolled = Number(await dm.locator('.roll-row', { hasText: 'Assassin' }).locator('.roll-in').inputValue());
check('the dice button fills in a d20 roll', rolled >= 1 && rolled <= 20, String(rolled));
await dm.screenshot({ path: '/tmp/shots/73-roll-popup.png' });
await dm.locator('.modal-foot .btn.primary').click();
await sleep(500);
const order = async () => dm.evaluate(() => window.__vtt.client.scene.init.entries.map((e) => e.n));
const sorted = (await order());
check('the order is sorted, highest first', sorted.length === 4 && sorted.join() !== '' && (await dm.evaluate(() => { const e = window.__vtt.client.scene.init.entries; return e.every((x, i) => i === 0 || e[i - 1].i >= x.i); })), sorted.join(' > '));
check('the Initiative tab lists them', (await dm.locator('.init-row').count()) === 4);
check('the first one has the turn', (await dm.locator('.init-row.turn').count()) === 1);
check('hidden tokens start as secret lines', await dm.evaluate(() => window.__vtt.client.scene.init.entries.find((e) => e.n === 'Assassin').h === true));
check('players see nothing yet', (await pl.locator('.initstrip').count()) === 0);

await dm.locator('.toggle', { hasText: 'Show the order to players' }).locator('input').check();
await sleep(500);
check('after revealing, players see the strip', (await pl.locator('.initstrip').count()) === 1);
const names = await pl.locator('.initstrip li .init-name > span:first-child').allInnerTexts();
check('without the secret line', names.length === 3 && !names.includes('Assassin'), names.join(', '));
await dm.screenshot({ path: '/tmp/shots/74-initiative-dm.png' });
await pl.screenshot({ path: '/tmp/shots/75-initiative-player.png' });

// turns
const turnName = (page) => page.locator('.initstrip li.turn .init-name > span:first-child').allInnerTexts();
const firstTurn = await dm.evaluate(() => { const s = window.__vtt.client.scene.init; return s.entries.find((e) => e.id === s.turn).n; });
await dm.getByRole('button', { name: /Next turn/ }).click();
await sleep(400);
const secondTurn = await dm.evaluate(() => { const s = window.__vtt.client.scene.init; return s.entries.find((e) => e.id === s.turn).n; });
check('Next turn moves on', firstTurn !== secondTurn, `${firstTurn} -> ${secondTurn}`);
await front(pl);
check('the golden halo follows the turn on the board', (await pl.evaluate(() => window.__vtt.board.currentTurnToken())) === (secondTurn === 'Assassin' ? null : (await pl.evaluate((n) => [...window.__vtt.client.scene.tokens.values()].find((t) => t.name === n)?.id, secondTurn))));
for (let i = 0; i < 3; i++) await dm.getByRole('button', { name: /Next turn/ }).click();
await sleep(400);
check('and the round counts up after the last one', (await dm.evaluate(() => window.__vtt.client.scene.init.round)) === 2 && (await pl.locator('.initstrip-head strong').innerText()) === '2');

// dragging and editing numbers
const rows = () => dm.locator('.init-row .init-name > span:first-child').allInnerTexts();
const before = await rows();
await dm.locator('.init-row').last().dragTo(dm.locator('.init-row').first());
await sleep(400);
const after = await rows();
check('dragging a line moves it in the order', after[0] === before[before.length - 1], `${before.join(',')} -> ${after.join(',')}`);
const lastInit = await dm.locator('.init-row').last().locator('.init-num');
await lastInit.fill('99');
await lastInit.press('Tab');
await sleep(400);
check('changing a number re-sorts the order', (await rows())[0] !== after[0] || (await dm.evaluate(() => window.__vtt.client.scene.init.entries[0].i)) === 99);

// hit points in the initiative list
const ogreRow = dm.locator('.init-row', { hasText: 'Ogre' });
check('rows show hit points for tokens that have them', (await ogreRow.locator('.init-hp').innerText()).includes('59/59'));
await ogreRow.locator('.init-dmg input').fill('20');
await ogreRow.locator('.init-dmg button[title="Damage"]').click();
await sleep(300);
check('damage from the list works', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)) === 39);
await ogreRow.locator('.init-dmg input').fill('4');
await ogreRow.locator('.init-dmg input').press('Enter');
await sleep(300);
check('Enter hurts', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)) === 35);
await ogreRow.locator('.init-dmg input').fill('+6');
await ogreRow.locator('.init-dmg input').press('Enter');
await sleep(300);
check('+6 then Enter heals', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)) === 41);
await ogreRow.locator('.init-dmg input').fill('1');
await ogreRow.locator('.init-dmg button[title="Heal"]').click();
await sleep(300);
check('and so does the heal button', (await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i).hp, ogre)) === 42);

// hide a line from players, then end combat
const goblinRow = dm.locator('.init-row', { hasText: 'Goblin' });
await goblinRow.locator('.icon-btn[title^="Players can see"]').click();
await sleep(400);
check('hiding a line removes it from the players\' list', !(await pl.locator('.initstrip li .init-name > span:first-child').allInnerTexts()).includes('Goblin'));
dm.once('dialog', (d) => d.accept());
await dm.getByRole('button', { name: 'End combat' }).click();
await sleep(500);
check('ending combat clears the order for everyone', (await dm.locator('.init-row').count()) === 0 && (await pl.locator('.initstrip').count()) === 0);

// ---- fog sight
await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
await dm.evaluate(() => window.__vtt.client.resetFog('hidden'));
await sleep(500);
const lum = async (page, sx, sy) => {
  await front(page);
  const buf = await page.screenshot({ clip: { x: sx - 3, y: sy - 3, width: 6, height: 6 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let s = 0; for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
    return s / (d.length / 4);
  }, buf.toString('base64'));
};
const toScreen = (page, wx, wy) => page.evaluate(([x, y]) => {
  const b = window.__vtt.board; const r = b.app.canvas.getBoundingClientRect();
  return { x: r.left + b.cam.tx + x * b.cam.zoom, y: r.top + b.cam.ty + y * b.cam.zoom };
}, [wx, wy]);
await pl.evaluate(() => window.__vtt.board.fit());
await sleep(300);
const spotA = await toScreen(pl, 3.5 * cell, 5.2 * cell);   // near the hero
const spotB = await toScreen(pl, 3.5 * cell, 11 * cell);    // far from everything
check('fog is solid for the player before anyone can see', (await lum(pl, spotA.x, spotA.y)) < 30);
await dm.evaluate((i) => window.__vtt.client.updateTokens([i], { sight: 30 }), hero);
await dm.locator('.sect-head', { hasText: 'Fog of war' }).waitFor();
await dm.locator('.toggle', { hasText: 'Tokens clear the fog around them' }).locator('input').check();
await sleep(500);
await front(pl);
const circles = await pl.evaluate(() => window.__vtt.board.visionNow());
check('the player\'s board has one vision circle, sized from the token\'s edge', circles.length === 1 && circles[0].id === hero && Math.abs(circles[0].r - 6.5 * cell) < 1, JSON.stringify(circles));
const lumNear = await lum(pl, spotA.x, spotA.y);
const lumFar = await lum(pl, spotB.x, spotB.y);
check('the map shows inside the circle and stays fogged outside it', lumNear > 60 && lumFar < 30, `near ${Math.round(lumNear)}, far ${Math.round(lumFar)}`);
await pl.screenshot({ path: '/tmp/shots/76-vision-player.png' });

// hidden tokens never clear fog; a test move does not peek
await dm.evaluate((i) => window.__vtt.client.updateTokens([i], { sight: 120 }), sneak);
await sleep(300);
check('a hidden token with sight reveals nothing for players', (await pl.evaluate(() => window.__vtt.board.visionNow().length)) === 1);

// explore: walk away and the ground stays revealed
await dm.locator('.toggle', { hasText: 'Keep what they have explored' }).locator('input').check();
await sleep(900);
const opsBefore = await dm.evaluate(() => window.__vtt.client.scene.fogOps.size);
check('turning on exploring reveals where the token stands', opsBefore >= 1);
await dm.evaluate(([i, x, y]) => window.__vtt.client.moveTokens([{ id: i, x, y }]), [hero, 12.5 * cell, 11.5 * cell]);
await sleep(1200);
const opsAfter = await dm.evaluate(() => window.__vtt.client.scene.fogOps.size);
check('moving adds to the explored ground', opsAfter > opsBefore, `${opsBefore} -> ${opsAfter}`);
await pl.evaluate(() => window.__vtt.board.fit());
await sleep(400);
const oldSpot = await toScreen(pl, 3.5 * cell, 4.2 * cell);
check('the place it left stays clear', (await lum(pl, oldSpot.x, oldSpot.y)) > 60);
await pl.screenshot({ path: '/tmp/shots/77-explored-player.png' });
await dm.evaluate(() => window.__vtt.ui.set({ dmPreview: false }));
await dm.screenshot({ path: '/tmp/shots/78-explored-dm.png' });

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
