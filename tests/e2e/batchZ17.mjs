// Round Z17: a reload keeps the scene you were on; a tidier initiative window; scenes that are just a grid; adding a second map from the library or as an empty grid.
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
await dm.getByPlaceholder('New table name').fill('Z17');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');

// ---- a brand new table offers a grid right on its first-scene card
await dm.locator('.empty-card').waitFor({ timeout: 8000 }).catch(() => {});
check('the first-scene card offers "Start with a grid"', (await dm.locator('.empty-card').getByRole('button', { name: 'Start with a grid' }).count()) === 1);
await dm.locator('.empty-card').getByRole('button', { name: 'Start with a grid' }).click();
await dm.locator('.modal input[aria-label="Squares across"]').waitFor();
check('it opens New scene with the grid already chosen', (await dm.getByRole('button', { name: 'Just a grid', exact: true }).getAttribute('aria-pressed')) === 'true');
await dm.getByRole('button', { name: 'Cancel' }).click();
await sleep(200);

// ---- the New scene window offers a plain grid, right from the start of a table
await dm.getByRole('button', { name: '+ New scene' }).first().click();
const gridBtn = dm.getByRole('button', { name: 'Just a grid', exact: true });
await gridBtn.waitFor();
check('New scene offers "Just a grid" beside uploading a map', (await dm.locator('.modal').getByText('Upload map…').count()) === 1);
await gridBtn.click();
await sleep(200);
check('it asks how many squares', (await dm.locator('.modal input[aria-label="Squares across"]').inputValue()) === '30' && (await dm.locator('.modal input[aria-label="Squares down"]').inputValue()) === '20');
await dm.locator('.modal input[aria-label="Squares across"]').fill('12');
await dm.locator('.modal input[aria-label="Squares across"]').dispatchEvent('change');
await dm.locator('.modal input[aria-label="Squares down"]').fill('9');
await dm.locator('.modal input[aria-label="Squares down"]').dispatchEvent('change');
await dm.screenshot({ path: '/tmp/shots/z17-newgrid.png' });
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.client?.scene?.meta);
await sleep(900);
const gm = await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { url: m.mapUrl, w: m.mapW, h: m.mapH, bg: m.bg, cell: m.grid.cell, name: m.name }; });
check('a scene with no picture and 12 by 9 squares was made', gm.url === null && gm.w === 12 * gm.cell && gm.h === 9 * gm.cell, JSON.stringify(gm));
check('it is called "Empty grid" and has a dark background so the lines show', gm.name === 'Empty grid' && gm.bg !== '#ffffff');
check('the paper is drawn', await dm.evaluate(() => { const s = window.__vtt.board.pageSprite; return !!s && Math.abs(s.width - window.__vtt.client.scene.meta.mapW) < 1 && s.visible; }));
check('and the board does not say it has no map', (await dm.locator('.hint-chip', { hasText: 'no map yet' }).count()) === 0);
check('the scene takes in the whole grid', await dm.evaluate(() => { const r = window.__vtt.client.sceneRect(); return r && r.w === window.__vtt.client.scene.meta.mapW; }));
await dm.screenshot({ path: '/tmp/shots/z17-grid-scene.png' });

// the Scene tab can change how big it is
await dm.locator('.dock-tabs button, .tabs button', { hasText: /^Scene$/ }).first().click().catch(() => {});
const across = dm.locator('.sect input[aria-label="Squares across"]').first();
await across.waitFor();
check('the Scene tab shows its size', (await across.inputValue()) === '12');
await across.fill('20');
await across.dispatchEvent('change');
await sleep(500);
check('and a new size is kept', await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return m.mapW === 20 * m.grid.cell; }));

// ---- a scene that was made without a map can become a grid
const bare = await dm.evaluate(() => window.__vtt.client.createScene({ name: 'Bare', makeActive: false }));
await sleep(700);
check('a scene made with no map has neither picture nor size', await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return m.name === 'Bare' && !m.mapUrl && !m.mapW; }));
check('and says it has no map', (await dm.locator('.hint-chip', { hasText: 'no map yet' }).count()) === 1);
await dm.getByRole('button', { name: 'Just a grid', exact: true }).click();
await sleep(600);
check('"Just a grid" in the Scene tab makes it a page of squares', await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return !m.mapUrl && m.mapW === 30 * m.grid.cell && m.mapH === 20 * m.grid.cell && m.bg !== '#ffffff'; }));
check('and the "no map yet" note goes', (await dm.locator('.hint-chip', { hasText: 'no map yet' }).count()) === 0);

// ---- a map, then an empty grid beside it, then a map from the library
// (a plain picture put straight into the scene, so the printed-grid look-up stays out of it)
await dm.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 700; c.height = 490;
  const g = c.getContext('2d'); g.fillStyle = '#9a8a6a'; g.fillRect(0, 0, 700, 490); g.fillStyle = '#5a4a3a'; g.fillRect(60, 60, 300, 200);
  return window.__vtt.client.updateScene({ mapUrl: c.toDataURL('image/png'), mapW: 700, mapH: 490, mapX: 0, mapY: 0, mapScale: 1, gridTried: true, bg: '#ffffff' });
});
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(700);
const main = await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { x: m.mapX, y: m.mapY, w: m.mapW * m.mapScale, h: m.mapH * m.mapScale, cell: m.grid.cell, ox: m.grid.ox, oy: m.grid.oy }; });
await dm.locator('.dock-tabs button, .tabs button', { hasText: /^Scene$/ }).first().click().catch(() => {});
await dm.getByText('Add a second map…').click();
await dm.getByRole('dialog', { name: 'Add a map' }).waitFor();
check('Add a map offers Upload, the library and an empty grid', (await dm.locator('.modal').getByText('Upload map…').count()) === 1 && (await dm.locator('.modal').getByText('Add an empty grid').count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z17-addmap.png' });
await dm.locator('.modal input[aria-label="Squares across"]').fill('8');
await dm.locator('.modal input[aria-label="Squares across"]').dispatchEvent('change');
await dm.locator('.modal input[aria-label="Squares down"]').fill('6');
await dm.locator('.modal input[aria-label="Squares down"]').dispatchEvent('change');
await dm.getByRole('button', { name: 'Add an empty grid' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.maps.length === 1, null, { timeout: 8000 });
await sleep(500);
const eg = await dm.evaluate(() => window.__vtt.client.scene.meta.maps[0]);
check('an empty grid of 8 by 6 squares was added', eg.url === 'blank:' && eg.w === 8 * main.cell && eg.h === 6 * main.cell, JSON.stringify(eg));
check('beside the map, on its grid lines', eg.x >= main.x + main.w - 0.01 && eg.x - (main.x + main.w) < main.cell && Math.abs(((eg.x - main.ox) / main.cell) % 1) < 1e-6 && Math.abs(((eg.y - main.oy) / main.cell) % 1) < 1e-6, JSON.stringify({ x: eg.x, y: eg.y }));
check('it is selected so it can be put in place', await dm.evaluate((id) => window.__vtt.ui.data.extraSel === id, eg.id));
check('and drawn as paper', await dm.evaluate((id) => { const e = window.__vtt.board.extras.get(id); return !!e && e.sprite.visible && Math.abs(e.sprite.width - window.__vtt.client.scene.meta.maps[0].w) < 1; }, eg.id));
check('the scene now takes in both', await dm.evaluate(() => { const r = window.__vtt.client.sceneRect(), m = window.__vtt.client.scene.meta; return r.w > m.mapW; }));
check('its card has squares, not a percentage', (await dm.locator('.extra-map input[aria-label="Squares across"]').count()) === 1 && (await dm.locator('.extra-map input[aria-label="Squares across"]').inputValue()) === '8');
await dm.locator('.extra-map input[aria-label="Squares down"]').fill('10');
await dm.locator('.extra-map input[aria-label="Squares down"]').dispatchEvent('change');
await sleep(500);
check('its size can be changed', await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return m.maps[0].h === 10 * m.grid.cell; }));
await dm.evaluate(() => window.__vtt.board.fit());
await sleep(500);
await dm.screenshot({ path: '/tmp/shots/z17-grid-beside.png' });

// a picture from the library goes in with one click, no upload
const libUrl = await dm.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 500; c.height = 300;
  const g = c.getContext('2d'); g.fillStyle = '#6a8f5a'; g.fillRect(0, 0, 500, 300); g.fillStyle = '#fff'; g.fillRect(40, 40, 120, 80);
  return c.toDataURL('image/png');
});
await dm.evaluate(([url]) => { const c = window.__vtt.client; return c.backend.set('users/' + c.uid + '/library/maps/seed1', { name: 'Green hall', url, thumb: url, w: 500, h: 300, addedAt: Date.now() }); }, [libUrl]);
await sleep(400);
await dm.getByText('Add another map…').click();
await dm.getByRole('dialog', { name: 'Add a map' }).waitFor();
await dm.locator('.modal .field-label', { hasText: 'From your library (1)' }).waitFor({ timeout: 5000 }).catch(() => {});
check('Add a map shows the library', (await dm.locator('.modal .field-label', { hasText: 'From your library (1)' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z17-addmap-lib.png' });
await dm.locator('.modal .thumb[title="Green hall"]').click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.maps.length === 2, null, { timeout: 8000 });
const lm = await dm.evaluate(() => window.__vtt.client.scene.meta.maps[1]);
check('the library map was added at once, as itself', lm.name === 'Green hall' && lm.w === 500 && lm.h === 300 && lm.url.startsWith('data:image/png'), JSON.stringify({ n: lm.name, w: lm.w, h: lm.h }));
check('and the window closed', (await dm.getByRole('dialog', { name: 'Add a map' }).count()) === 0);

// ---- the initiative window is tidier
await dm.evaluate(() => window.__vtt.ui.set({ initOpen: false }));
await dm.evaluate(([a, b]) => { const c = window.__vtt.client; return Promise.all([c.addToken({ x: a, y: 100, name: 'Ana', size: 1 }), c.addToken({ x: b, y: 100, name: 'Bo', size: 1 })]); }, [140, 280]);
await sleep(500);
await dm.keyboard.press('i');
await dm.getByRole('dialog', { name: 'Initiative' }).waitFor();
const pop = dm.getByRole('dialog', { name: 'Initiative' });
const popText = async () => (await pop.innerText()).replace(/\s+/g, ' ');
let t = await popText();
check('no "no combat yet"', !/no combat yet/i.test(t), t.slice(0, 120));
check('no turn buttons before combat starts', (await pop.getByRole('button', { name: /Next turn/ }).count()) === 0 && (await pop.getByRole('button', { name: '◀' }).count()) === 0);
check('no "Roll here, or type" line', !/Roll here, or type/.test(t));
check('only one place to roll', (await pop.getByRole('button', { name: /Roll all empty/ }).count()) === 1 && !/Roll or type some numbers/.test(t));
await pop.getByRole('button', { name: /Roll all empty/ }).click();
await sleep(300);
t = await popText();
check('rolling shows the one button that adds them', (await pop.getByRole('button', { name: /^Add \d+ to the order$/ }).count()) === 1);
await pop.getByRole('button', { name: /^Add \d+ to the order$/ }).click();
await sleep(500);
check('once combat has started the turn buttons appear', (await pop.getByRole('button', { name: /Next turn/ }).count()) === 1 && /Round/.test(await popText()));
await dm.screenshot({ path: '/tmp/shots/z17-initiative.png' });
await dm.evaluate(() => window.__vtt.ui.set({ initOpen: false }));
// a window with no tokens at all
await dm.evaluate(() => { const c = window.__vtt.client; return c.removeTokens([...c.scene.tokens.keys()]); });
await dm.evaluate(() => window.__vtt.client.initClear?.());
await sleep(300);

// ---- the DM can open a player's saved tokens and handouts from the Tokens tab, and change them
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(600);
await pl.keyboard.press('Escape');
const pid = await pl.evaluate(() => window.__vtt.client.uid);
await dm.bringToFront();
// the scene the players are on
await dm.evaluate(() => window.__vtt.client.openScene(window.__vtt.client.activeSceneId));
await sleep(600);
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'bright' } }));
const heroId = await dm.evaluate((uid) => window.__vtt.client.addToken({ x: 210, y: 210, name: 'Aria the Bold', ownerUid: uid, maxHp: 20, hp: 20 }), pid);
await sleep(700);
await pl.bringToFront();
const savedOk = await pl.evaluate((id) => window.__vtt.client.saveTokenToLibrary(id), heroId);
await sleep(700);
check('the player saved their character', savedOk && (await pl.evaluate(() => window.__vtt.client.tokenLib.length)) === 1);
await dm.bringToFront();
await dm.evaluate(() => window.__vtt.client.saveHandout({ title: 'A letter for Aria', text: 'Meet me at dawn.', img: null }).then((id) => window.__vtt.client.showHandout(id, [window.__vtt.client.players.size ? [...window.__vtt.client.players.values()].find((p) => !p.dm).uid : null])));
await dm.evaluate(() => window.__vtt.client.saveHandout({ title: 'The wanted poster', text: 'Everyone sees it.', img: null }));
await sleep(500);
await dm.locator('.rail-tab', { hasText: /^Tokens$/ }).click();
const chip = dm.locator('.tok-people .chip', { hasText: 'Aria' });
await chip.waitFor();
check('the Tokens tab lists the players', (await dm.locator('.tok-people .chip').count()) === 1);
await chip.click();
const card = dm.getByRole('dialog', { name: 'Aria' });
await card.waitFor();
await card.locator('[data-saved]').first().waitFor({ timeout: 5000 });
check('clicking a player shows their saved token', (await card.locator('[data-saved] .lib-name', { hasText: 'Aria the Bold' }).count()) === 1);
check('and the handouts that are theirs, whoever else can see them', (await card.getByText('A letter for Aria').count()) === 1 && (await card.getByText('The wanted poster').count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z17-playercard.png' });
await card.locator('[data-saved]').first().getByRole('button', { name: 'Edit' }).click();
const ed = dm.getByRole('dialog', { name: /Edit saved token/ });
await ed.waitFor();
check('Edit opens the token editor on the saved token', (await ed.locator('input[type=text]').first().inputValue()) === 'Aria the Bold');
check('without the things that belong to one place on a map', (await ed.getByText('Controlled by').count()) === 0 && (await ed.getByText('Hit points now').count()) === 0 && (await ed.getByText('Flying').count()) === 0);
check('but with the maximum hit points', (await ed.getByText('Maximum', { exact: true }).count()) === 1);
await ed.locator('input[type=text]').first().fill('Aria the Brave');
await ed.locator('input[placeholder="Max"]').fill('30');
await ed.getByRole('button', { name: 'Save' }).click();
await sleep(800);
check('the editor closed and the saved token has the new name', (await dm.getByRole('dialog', { name: /Edit saved token/ }).count()) === 0 && (await card.locator('[data-saved] .lib-name', { hasText: 'Aria the Brave' }).count()) === 1);
check('and the player sees it in their own library', await pl.evaluate(() => window.__vtt.client.tokenLib.map((e) => e.name).join() === 'Aria the Brave'));
check('with the maximum hit points the DM gave it, and still the same character', await pl.evaluate(() => { const e = window.__vtt.client.tokenLib[0]; return e.t.maxHp === 30 && e.t.cid === e.id; }));
await card.locator('li', { hasText: 'A letter for Aria' }).getByRole('button', { name: 'Edit' }).click();
const hd = dm.getByRole('dialog', { name: 'Change handout' });
await hd.waitFor();
check('a handout opens straight in the editor', (await hd.locator('input[type=text]').first().inputValue()) === 'A letter for Aria' && (await hd.locator('textarea').inputValue()) === 'Meet me at dawn.');
await hd.locator('textarea').fill('Meet me at dusk.');
await hd.getByRole('button', { name: 'Save' }).click();
await sleep(600);
check('the change to the handout is kept', await dm.evaluate(() => [...window.__vtt.client.handouts.values()].some((h) => h.title === 'A letter for Aria' && h.text === 'Meet me at dusk.')));
await dm.screenshot({ path: '/tmp/shots/z17-handout-edit.png' });
await dm.keyboard.press('Escape');
await sleep(300);
await dm.keyboard.press('Escape');
await sleep(300);
const left = await dm.getByRole('dialog').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
check('Escape closes the windows one at a time', left.length === 0, JSON.stringify(left));
await dm.locator('.rail-tab', { hasText: /^Tokens$/ }).click().catch(() => {});

// ---- a reload stays on the scene you were on
const ids = await dm.evaluate(() => ({ view: window.__vtt.client.viewSceneId, active: window.__vtt.client.activeSceneId, all: window.__vtt.client.sceneIndex.map((s) => s.id) }));
const other = ids.all.find((id) => id !== ids.active) ?? ids.all[0];
await dm.evaluate((id) => window.__vtt.client.openScene(id), other);
await sleep(600);
check('a scene that is not the active one is open', await dm.evaluate(([o, a]) => window.__vtt.client.viewSceneId === o && o !== a, [other, ids.active]));
await dm.reload();
const reopened = await dm.waitForFunction(() => window.__vtt?.client?.viewSceneId, null, { timeout: 15000 }).then(() => true).catch(() => false);
if (!reopened) { await dm.getByRole('button', { name: /Z17|Open|Continue/ }).first().click().catch(() => {}); await dm.waitForFunction(() => window.__vtt?.client?.viewSceneId, null, { timeout: 15000 }).catch(() => {}); }
await sleep(800);
const after = await dm.evaluate(() => ({ view: window.__vtt?.client?.viewSceneId, active: window.__vtt?.client?.activeSceneId }));
check('after a reload the same scene is open', after.view === other, JSON.stringify({ after, other }));
check('not the one players are on', after.view !== after.active);

// ---- the Players tab holds a plain Player view switch
await dm.evaluate(() => window.__vtt.ui.set({ dockTab: 'players', dmPreview: false }));
await sleep(300);
const pv = dm.locator('.dock-players .toggle', { hasText: 'Player view' });
check('the Players tab has a "Player view" switch', (await pv.count()) === 1);
check('it is a plain switch that is off to begin with', (await pv.locator('input[type=checkbox]').isChecked()) === false);
await pv.locator('input[type=checkbox]').click();
await sleep(300);
check('turning it on shows the player view', await dm.evaluate(() => window.__vtt.ui.data.dmPreview === true));
check('and no menu opened', (await dm.getByRole('menu').count()) === 0 && (await dm.getByRole('dialog').count()) === 0);
await dm.keyboard.press('o');
await sleep(300);
check('the O key and the switch agree', await dm.evaluate(() => window.__vtt.ui.data.dmPreview === false) && (await pv.locator('input[type=checkbox]').isChecked()) === false);
await dm.screenshot({ path: '/tmp/shots/z17-playerview-toggle.png' });

const real = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
