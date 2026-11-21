// Visual + behaviour checks for the batch A UI (token tag, editor, players, dock, themes).
import { launch, watch, sleep } from './lib.mjs';
const BASE = (process.env.BASE || 'http://127.0.0.1:4174/') + '?demo';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const { browser, context } = await launch();
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.evaluate(() => localStorage.removeItem('vtt-theme'));
await dm.reload();
check('light theme is the default', (await dm.evaluate(() => document.documentElement.dataset.theme)) === 'light');
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('Test');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(300);

// DM has a default name
check('DM default name is DM', await dm.evaluate(() => window.__vtt.client.me?.name) === 'DM');

// add a token with a picture
const tokenImg = await dm.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 400; c.height = 300;
  const x = c.getContext('2d'); x.fillStyle = '#c92a2a'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#ffd43b'; x.beginPath(); x.arc(120, 150, 90, 0, 7); x.fill();
  x.fillStyle = '#1971c2'; x.fillRect(260, 40, 120, 220);
  return c.toDataURL('image/png');
});
const id = await dm.evaluate(async (img) => {
  const { client, ui } = window.__vtt;
  const id = await client.addToken({ x: 350, y: 350, name: 'Goblin', img, size: 1 });
  ui.select([id]);
  return id;
}, tokenImg);
await sleep(500);
check('token tag shows the name', (await dm.locator('.tokentag .tt-name').innerText()) === 'Goblin');
check('inspector sliders are gone from the board', (await dm.locator('.dock >> text=Image zoom').count()) === 0);
await dm.screenshot({ path: '/tmp/shots/40-tag-light.png' });

// open the editor with E and drag the picture
await dm.keyboard.press('e');
await dm.waitForSelector('.crop-stage');
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/41-editor-light.png' });
const stage = await dm.locator('.crop-stage').boundingBox();
await dm.mouse.move(stage.x + 150, stage.y + 150);
await dm.mouse.down();
await dm.mouse.move(stage.x + 190, stage.y + 130, { steps: 5 });
await dm.mouse.up();
await dm.mouse.move(stage.x + 150, stage.y + 150);
await dm.mouse.wheel(0, -300);
await sleep(200);
await dm.screenshot({ path: '/tmp/shots/42-editor-dragged.png' });
await dm.getByRole('button', { name: 'Save' }).click();
await sleep(300);
const t = await dm.evaluate((i) => window.__vtt.client.scene.tokens.get(i), id);
check('dragging and zooming in the editor saved the framing', t.imgX > 0.1 && t.imgY < -0.05 && t.imgScale > 1.2, `x=${t.imgX.toFixed(2)} y=${t.imgY.toFixed(2)} z=${t.imgScale.toFixed(2)}`);

// players modal + rename
await dm.locator('button.players').click();
await dm.waitForSelector('.player-row');
await dm.locator('.me-edit input[type=text]').fill('Narrator');
await dm.locator('.me-edit input[type=text]').blur();
await sleep(200);
check('DM can rename themselves', await dm.evaluate(() => window.__vtt.client.me.name) === 'Narrator');
await dm.screenshot({ path: '/tmp/shots/43-players.png' });
await dm.keyboard.press('Escape');

// dock: collapse a section, hide the dock
await dm.locator('.sect-head', { hasText: 'Grid' }).click();
check('a section can be collapsed', (await dm.locator('.dock >> text=Show grid').count()) === 0);
await dm.screenshot({ path: '/tmp/shots/44-dock-collapsed.png' });
await dm.locator('.dock .icon-btn[title="Hide this panel"]').click();
check('the dock can be hidden', (await dm.locator('.dock').count()) === 0 && (await dm.locator('.dock-tab').count()) === 1);
await dm.locator('.dock-tab').click();
check('and shown again', (await dm.locator('.dock').count()) === 1);
await dm.locator('.sect-head', { hasText: 'Grid' }).click();
await dm.locator('.sect-head', { hasText: 'Fine-tune' }).click();
await sleep(150);
const sw = await dm.locator('.dock input[type=range]').first().boundingBox();
check('sliders are a decent width', sw.width > 120, `${Math.round(sw.width)}px`);

// themes now live in Settings
await dm.getByRole('button', { name: 'Settings' }).click();
await sleep(200);
check('no light/dark button in the top bar', (await dm.locator('button[title="Switch light / dark"]').count()) === 0);
check('settings lists several themes', (await dm.locator('.theme-tile').count()) >= 5);
await dm.locator('.theme-tile', { hasText: 'Dark' }).first().click();
await sleep(200);
await dm.screenshot({ path: '/tmp/shots/45-dark-settings.png' });
check('theme switches to dark', (await dm.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
check('the drawing surface stays white in dark mode', (await dm.evaluate(() => window.__vtt.client.scene?.meta?.bg)) === '#ffffff');
await dm.locator('.theme-tile', { hasText: 'Light' }).first().click();
await sleep(150);
await dm.keyboard.press('Escape');
await sleep(150);

// player joins, then DM removes them
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(500);
const joined = await dm.evaluate(() => [...window.__vtt.client.players.values()].filter((p) => !p.dm).length);
check('player joined', joined === 1, `players=${joined}`);

// the player renames themselves and picks a new colour later
await pl.keyboard.press('Escape'); // the "pick your character" offer
await sleep(150);
await pl.locator('button.players').click();
await pl.locator('.me-edit input[type=text]').fill('Aria the Bold');
await pl.locator('.me-edit input[type=text]').blur();
await pl.locator('.me-edit .swatch').nth(3).click();
await sleep(300);
const ar = await dm.evaluate(() => [...window.__vtt.client.players.values()].find((p) => !p.dm));
check('player rename + colour reach the DM', ar.name === 'Aria the Bold' && ar.color !== '#ffffff', `${ar.name} ${ar.color}`);
await pl.keyboard.press('Escape');

// DM removes the player; the player lands back on the join form
await dm.locator('button.players').click();
dm.once('dialog', (d) => d.accept());
await dm.locator('.player-row .btn.danger').first().click();
await sleep(600);
const left = await dm.evaluate(() => [...window.__vtt.client.players.values()].filter((p) => !p.dm).length);
check('DM removed the player', left === 0);
check('removed player is sent back to the join form', (await pl.getByRole('button', { name: 'Join table' }).count()) === 1);
await dm.keyboard.press('Escape');
console.log(errors.filter((e) => !/GL Driver|404/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
