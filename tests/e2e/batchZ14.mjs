// Tables you can rename and delete from the start page; the map library in New scene is searchable, opens out and previews on hover;
// no paste-a-link boxes; a first scene has no "summon players" tick.
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
dm.on('dialog', (d) => { void d.accept(); });
await dm.goto(BASE);
await dm.evaluate(() => localStorage.clear());
await dm.reload();
await dm.getByRole('button', { name: /Start as the DM/ }).click();

// ---- the table list: rename and delete
await dm.getByPlaceholder('New table name').fill('Alpha');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.evaluate(() => { location.hash = ''; });
await dm.locator('.list li', { hasText: 'Alpha' }).waitFor();
check('the table list shows Rename and Delete', (await dm.locator('.list li', { hasText: 'Alpha' }).getByRole('button', { name: 'Rename' }).count()) === 1 && (await dm.locator('.list li', { hasText: 'Alpha' }).getByRole('button', { name: 'Delete' }).count()) === 1);
await dm.locator('.list li', { hasText: 'Alpha' }).getByRole('button', { name: 'Rename' }).click();
await dm.getByLabel('New name for Alpha').fill('Beta');
await dm.keyboard.press('Enter');
await dm.locator('.list li', { hasText: 'Beta' }).waitFor();
check('renaming changes the name in the list', (await dm.locator('.list li', { hasText: 'Alpha' }).count()) === 0);
await dm.locator('.list li', { hasText: 'Beta' }).getByRole('link', { name: 'Open' }).click();
await dm.waitForSelector('.board-host canvas');
check('the renamed table opens with its new name', (await dm.evaluate(() => window.__vtt.client.meta?.name)) === 'Beta');
await dm.evaluate(() => { location.hash = ''; });
await dm.locator('.list li', { hasText: 'Beta' }).getByRole('button', { name: 'Delete' }).click();
await dm.getByText('No tables yet').waitFor();
check('deleting removes the table from the list', (await dm.locator('.list li').count()) === 0);

// ---- a new table: a first scene has no summon tick
await dm.getByPlaceholder('New table name').fill('Gamma');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
const modalText = await dm.locator('.modal').innerText();
check('the New scene window has no summon tick on a table nobody has joined', !/Summon players to it/.test(modalText));
check('and no paste-a-link box', (await dm.getByPlaceholder(/paste a link/).count()) === 0 && !/paste a link/i.test(modalText));
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
check('the first scene is the live one', (await dm.evaluate(() => window.__vtt.client.activeSceneId)) !== null);

// ---- the map library: search, open out, hover
await dm.evaluate(async () => {
  const c = window.__vtt.client;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const url = canvas.toDataURL();
  const names = ['Cave', 'Cavern deep', 'Forest road', 'Forest camp', 'Tavern', 'Castle hall', 'Dungeon one', 'Dungeon two', 'Ship deck', 'Desert', 'Swamp', 'Temple', 'Crypt', 'Market'];
  for (const [i, n] of names.entries()) await c.backend.set(`users/${c.uid}/library/maps/m${i}`, { name: n, url, thumb: url, w: 4, h: 4, addedAt: 100 + i });
});
await dm.locator('select.scene-select').selectOption('__new');
const scene = dm.locator('.modal', { hasText: 'New scene' });
await scene.locator('.picture-tile').first().waitFor();
check('the library shows the first dozen with a Show all button', (await scene.locator('.picture-tile').count()) === 12 && (await scene.getByRole('button', { name: 'Show all 14' }).count()) === 1);
check('and a search box', (await scene.getByLabel('Search your library').count()) === 1);
await scene.getByLabel('Search your library').fill('cav');
check('searching finds pictures by name, from the whole library', (await scene.locator('.picture-tile').count()) === 2);
await scene.getByLabel('Search your library').fill('forest camp');
check('every word has to match', (await scene.locator('.picture-tile').count()) === 1);
await scene.getByLabel('Search your library').fill('zzz');
check('no match says so', (await scene.getByText(/Nothing in your library matches/).count()) === 1);
await scene.getByRole('button', { name: 'Clear' }).click();
const narrow = (await dm.locator('.modal').boundingBox()).width;
await scene.getByRole('button', { name: 'Show all 14' }).click();
await sleep(200);
const wide = (await dm.locator('.modal').boundingBox()).width;
check('Show all opens the library out to every picture in a wider window', (await scene.locator('.picture-tile').count()) === 14 && wide > narrow + 100, `${narrow} -> ${wide}`);
check('with the names shown', (await scene.locator('.picture-tile .lib-name').count()) === 14);
await scene.locator('.picture-tile').nth(3).hover();
await dm.locator('.lib-preview').waitFor();
check('pointing at a picture shows it larger with its name', /./.test(await dm.locator('.lib-preview-cap').innerText()) && (await dm.locator('.lib-preview img').count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z14-library.png' });
await dm.mouse.move(5, 5);
await sleep(150);
check('the preview goes away again', (await dm.locator('.lib-preview').count()) === 0);
await scene.getByRole('button', { name: 'Show fewer' }).click();
check('Show fewer folds it back', (await scene.locator('.picture-tile').count()) === 12);
await dm.getByRole('button', { name: 'Cancel' }).click();

// ---- My library has the same search and no link box
await dm.getByRole('button', { name: 'Library', exact: true }).click();
const lib = dm.locator('.modal', { hasText: 'My library' });
check('My library has no paste-a-link box', (await dm.getByPlaceholder(/paste a link/).count()) === 0);
await lib.getByLabel('Search your library').fill('dungeon');
check('and searches too', (await lib.locator('.lib-item').count()) === 2);

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
const ok = results.filter(Boolean).length;
console.log(`${ok}/${results.length} checks passed`);
await browser.close();
process.exit(ok === results.length ? 0 : 1);
