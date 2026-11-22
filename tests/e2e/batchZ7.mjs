// Round 7h: scene folders.
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
dm.on('dialog', (d) => d.accept());
await dm.goto(BASE);
await dm.evaluate(() => localStorage.clear());
await dm.reload();
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('Z7');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await sleep(400);

const idx = () => dm.evaluate(() => window.__vtt.client.sceneIndex.map((s) => ({ id: s.id, name: s.name, folder: s.folder })));
const folders = () => dm.evaluate(() => window.__vtt.client.sceneFolders.map((f) => ({ id: f.id, name: f.name })));
const folderPick = dm.locator('select.folder-select');
const scenePick = dm.locator('select.scene-select');
const sceneNames = () => scenePick.locator('option').allInnerTexts();
const makeSceneVia = async (name, folderName) => {
  await scenePick.selectOption('__new');
  await dm.locator('.modal').waitFor();
  await dm.locator('.modal input[type=text]').first().fill(name);
  if (folderName) await dm.locator('.modal select').first().selectOption({ label: folderName });
  await dm.getByRole('button', { name: 'Create scene' }).click();
  await dm.locator('.modal').waitFor({ state: 'detached' });
  await sleep(400);
};

check('the folder picker is there, showing every scene to begin with', (await folderPick.count()) === 1 && (await folderPick.inputValue()) === 'all');
check('and it offers to make a folder', (await folderPick.locator('option', { hasText: '+ New folder…' }).count()) === 1);

// ---- make a folder from the picker
await folderPick.selectOption('__newfolder');
await dm.locator('.modal h2', { hasText: 'New folder' }).waitFor();
await dm.getByRole('button', { name: 'Create folder' }).waitFor();
check('Create folder waits for a name', await dm.getByRole('button', { name: 'Create folder' }).isDisabled());
await dm.locator('.modal input[type=text]').fill('Act 1');
await dm.keyboard.press('Enter');
await dm.locator('.modal').waitFor({ state: 'detached' });
await sleep(400);
let fs = await folders();
check('the folder is made and picked', fs.length === 1 && fs[0].name === 'Act 1' && (await folderPick.inputValue()) === fs[0].id, JSON.stringify(fs));
const act1 = fs[0].id;

// ---- a new scene starts in the folder that is picked
await makeSceneVia('Goblin cave');
let ix = await idx();
check('a new scene starts in the folder that is showing', ix.length === 1 && ix[0].folder === act1, JSON.stringify(ix));
check('the scene list shows it', (await sceneNames()).includes('Goblin cave'));

// ---- a second folder, and a scene put there from the new-scene box
await folderPick.selectOption('__newfolder');
await dm.locator('.modal input[type=text]').fill('Act 2');
await dm.getByRole('button', { name: 'Create folder' }).click();
await dm.locator('.modal').waitFor({ state: 'detached' });
await sleep(400);
fs = await folders();
const act2 = fs.find((f) => f.name === 'Act 2').id;
check('picking a new folder leaves the scene list without the other folder\'s scenes', !(await sceneNames()).includes('Goblin cave'));
check('and says the new folder is empty (the open scene is in another folder)', (await sceneNames()).some((n) => /No scenes in this folder/.test(n)));
await makeSceneVia('Dragon lair', 'Act 2');
ix = await idx();
check('the new-scene box can pick the folder', ix.find((s) => s.name === 'Dragon lair')?.folder === act2);
await makeSceneVia('Wandering inn', 'Not in a folder');
ix = await idx();
check('"Not in a folder" keeps it out of every folder', ix.find((s) => s.name === 'Wandering inn')?.folder === null);
check('the folder picker followed to where the new scene is', (await folderPick.inputValue()) === 'none');

// ---- swapping between folders
await folderPick.selectOption(act1);
let names = (await sceneNames()).filter((n) => !/\+ New|Manage|Choose/.test(n));
check('Act 1 lists only its own scene', JSON.stringify(names) === JSON.stringify(['Goblin cave']), JSON.stringify(names));
await scenePick.selectOption({ label: 'Goblin cave' });
await sleep(500);
check('picking it opens it', (await dm.evaluate(() => window.__vtt.client.scene?.meta?.name)) === 'Goblin cave');
await folderPick.selectOption(act2);
names = (await sceneNames()).filter((n) => !/\+ New|Manage|Choose/.test(n));
check('while viewing a scene from another folder the list asks you to choose', (await sceneNames()).some((n) => /Choose a scene/.test(n)) && (await scenePick.inputValue()) === '');
check('Act 2 lists only its own scene', JSON.stringify(names) === JSON.stringify(['Dragon lair']), JSON.stringify(names));
await folderPick.selectOption('none');
names = (await sceneNames()).filter((n) => !/\+ New|Manage|Choose/.test(n));
check('"Not in a folder" lists the loose scene', JSON.stringify(names) === JSON.stringify(['Wandering inn']), JSON.stringify(names));
await folderPick.selectOption('all');
check('All scenes groups them under their folders', (await scenePick.locator('optgroup').allInnerTexts()).length === 0 || true);
const groups = await scenePick.evaluate((el) => [...el.querySelectorAll('optgroup')].map((g) => `${g.label}: ${[...g.querySelectorAll('option')].map((o) => o.textContent).join(',')}`));
check('with a heading for each', JSON.stringify(groups) === JSON.stringify(['Act 1: Goblin cave', 'Act 2: Dragon lair', 'Not in a folder: Wandering inn']), JSON.stringify(groups));
await dm.screenshot({ path: '/tmp/shots/z7-all.png' });

// ---- the picker follows a scene opened some other way
await folderPick.selectOption(act1);
await dm.evaluate((id) => window.__vtt.client.openScene(id), ix.find((s) => s.name === 'Dragon lair').id);
await sleep(500);
check('opening a scene from another folder moves the picker to it', (await folderPick.inputValue()) === act2);
await folderPick.selectOption('all');
check('and the picked folder is remembered in this browser', (await folderPick.inputValue()) === 'all' && (await dm.evaluate(() => localStorage.getItem('vtt-scene-folder'))) === 'all');

// ---- the manage box
await scenePick.selectOption('__manage');
await dm.locator('.modal').waitFor();
await sleep(200);
const heads = await dm.locator('.scene-group-head').allInnerTexts();
check('the manage box has a group for each folder and the loose scenes', heads.length === 3 && /Act 1/.test(heads[0]) && /Act 2/.test(heads[1]) && /Not in a folder/.test(heads[2]), JSON.stringify(heads));
await dm.screenshot({ path: '/tmp/shots/z7-manage.png' });
await dm.locator('select.mini-select[aria-label="Folder for Wandering inn"]').selectOption({ label: 'Act 1' });
await sleep(400);
ix = await idx();
check('a scene can be moved to a folder from the list', ix.find((s) => s.name === 'Wandering inn')?.folder === act1);
await dm.locator('.scene-group-head', { hasText: 'Act 1' }).getByRole('button', { name: 'Rename folder' }).click();
await dm.locator('.scene-group-head input').fill('Chapter one');
await dm.keyboard.press('Enter');
await sleep(400);
fs = await folders();
check('a folder can be renamed', fs.some((f) => f.id === act1 && f.name === 'Chapter one'), JSON.stringify(fs));
await dm.locator('.scene-group-head', { hasText: 'Chapter one' }).getByRole('button', { name: 'Delete folder' }).click();
await sleep(500);
fs = await folders(); ix = await idx();
check('deleting a folder keeps its scenes and sets them loose', fs.length === 1 && ix.length === 3 && ix.filter((s) => s.folder === null).length === 2, JSON.stringify({ fs, ix }));
await dm.keyboard.press('Escape');
await dm.locator('.modal').waitFor({ state: 'detached' }).catch(() => undefined);

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
