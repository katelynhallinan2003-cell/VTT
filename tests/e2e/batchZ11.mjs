// Dropping a picture on the page: the map of a first scene on an empty table, the map in the New scene box, a token once there are scenes.
// Also: the page says what a drop will do, Settings is in tabs, the tools are in groups, and nothing at the top covers the top bar.
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
await dm.getByPlaceholder('New table name').fill('Z11');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.locator('.empty-card').waitFor();

// a made-up drag: a small picture with a 70 px grid on it, handed to the page the way a file from the desktop is
const drag = (type, selector) => dm.evaluate(async ([type, selector]) => {
  const c = document.createElement('canvas');
  c.width = 700; c.height = 560;
  const x = c.getContext('2d');
  x.fillStyle = '#b9a98a'; x.fillRect(0, 0, 700, 560);
  x.strokeStyle = '#3a3226'; x.lineWidth = 2;
  for (let i = 0; i <= 700; i += 70) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 560); x.stroke(); }
  for (let j = 0; j <= 560; j += 70) { x.beginPath(); x.moveTo(0, j); x.lineTo(700, j); x.stroke(); }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], 'Goblin cave.png', { type: 'image/png' }));
  document.querySelector(selector).dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 700, clientY: 400 }));
}, [type, selector]);

// ---- an empty table
check('the empty table says a map can be dragged in', /drag a map picture/i.test(await dm.locator('.empty-card').innerText()));
await drag('dragenter', '.table-root');
await sleep(200);
check('while a picture is over the page it says it will become the map', /use it as your map/i.test(await dm.locator('.drop-veil').innerText().catch(() => '')));
await drag('drop', '.table-root');
await dm.locator('.modal h2', { hasText: 'New scene' }).waitFor();
check('dropping it opens New scene with the picture in it', (await dm.locator('.dropzone-name').innerText()) === 'Goblin cave.png' && (await dm.locator('.drop-veil').count()) === 0);
check('with a small look at the picture', (await dm.locator('.dropzone-file img').count()) === 1);
check('and nothing has been made yet', (await dm.evaluate(() => window.__vtt.client.sceneIndex.length)) === 0);

// ---- the New scene box takes a drop anywhere while it is open
await dm.locator('.dropzone-file .icon-btn').click();
check('the picture can be taken out again', (await dm.locator('.dropzone-file').count()) === 0 && /Drag a map picture here/.test(await dm.locator('.dropzone').innerText()));
await drag('dragenter', '.modal');
await sleep(150);
check('the box lights up while a picture is over the page', (await dm.locator('.dropzone.over').count()) === 1);
await drag('drop', '.modal-back');
await sleep(200);
check('a drop anywhere goes into the box, not to the board behind', (await dm.locator('.dropzone-name').innerText()) === 'Goblin cave.png' && (await dm.locator('.modal h2').innerText()) === 'New scene');
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await dm.waitForFunction(() => !!window.__vtt.client.scene?.meta?.mapGrid, null, { timeout: 15000 }).catch(() => {});
const meta = await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { name: m.name, cut: m.mapGrid, cell: m.grid.cell }; });
check('the scene is named after the file', meta.name === 'Goblin cave', meta.name);
check('and the grid printed on the dropped map is found and matched', !!meta.cut && Math.abs(meta.cut.p - 70) < 0.3 && Math.abs(meta.cell - 70) < 0.3, JSON.stringify(meta));

// ---- once there are scenes, a dropped picture is a token
await drag('dragenter', '.table-root');
await sleep(200);
check('now the page says a drop makes a token', /make a token/i.test(await dm.locator('.drop-veil').innerText().catch(() => '')));
await drag('drop', '.table-root');
await dm.locator('.modal h2', { hasText: 'Add token' }).waitFor();
check('and it opens Add token with the picture', (await dm.locator('.modal input[type=text]').first().inputValue()) === 'Goblin cave' && (await dm.locator('.drop-veil').count()) === 0);
check('Add token asks for the picture before anything else, with the paint tools tucked away', (await dm.locator('.modal .seg button', { hasText: 'Erase image' }).count()) === 0 && (await dm.locator('.modal .btn', { hasText: /^Picture tools/ }).count()) === 1);
await dm.locator('.modal .btn', { hasText: /^Picture tools/ }).click();
check('and Picture tools brings them out', (await dm.locator('.modal .seg button', { hasText: 'Erase image' }).count()) === 1);
await dm.locator('.modal input[type=text]').first().fill('Captain');
await drag('drop', '.modal');
await sleep(300);
check('a picture dropped while Add token is open goes into it, and what was typed stays', (await dm.locator('.modal h2').innerText()) === 'Add token' && (await dm.locator('.modal input[type=text]').first().inputValue()) === 'Captain' && (await dm.locator('.modal .muted', { hasText: 'Goblin cave.png' }).count()) === 1);
await dm.keyboard.press('Escape');
await sleep(200);

// ---- the right-click menu opens and stays open (on Windows the browser's own "context menu" event comes after the button is let go)
await dm.mouse.click(700, 500, { button: 'right' });
await sleep(400);
check('a right click on the board opens the menu, and it stays', (await dm.locator('.ctx').count()) === 1 && /Add token here/.test(await dm.locator('.ctx').innerText()));
await dm.keyboard.press('Escape');

// ---- Settings is a page at a time
await dm.locator('.pill-right button', { hasText: 'Settings' }).click();
const tabs = await dm.locator('.modal .tabs button').allInnerTexts();
check('Settings has four tabs', JSON.stringify(tabs) === JSON.stringify(['Table', 'Pictures and files', 'You', 'Mouse and keys']), JSON.stringify(tabs));
check('and opens on the table', (await dm.locator('.modal', { hasText: 'What players can do' }).count()) === 1 && (await dm.locator('.modal .keys').count()) === 0);
await dm.keyboard.press('Escape');
await dm.keyboard.press('Shift+Slash');
await sleep(200);
check('? opens it on the shortcuts', (await dm.locator('.modal .keys').count()) === 1);
await dm.keyboard.press('Escape');

// ---- the tools: everyday ones first, then the DM's
const tools = await dm.locator('.toolbar .tool').evaluateAll((b) => b.map((x) => x.getAttribute('aria-label').split(':')[0]));
check('the toolbar starts with select, add token and ruler', JSON.stringify(tools.slice(0, 3)) === JSON.stringify(['Select / move', 'Add token', 'Ruler']), JSON.stringify(tools));
check('and the scene tools come together after the drawing tools', tools.indexOf('Fog of war') > tools.indexOf('Spell templates') && tools.indexOf('Walls') === tools.indexOf('Fog of war') + 1);

// ---- on a laptop-sized screen nothing at the top covers the top bar
await dm.setViewportSize({ width: 1366, height: 768 });
await dm.keyboard.press('m');
await sleep(600);
const boxes = await dm.evaluate(() => {
  const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { x: b.left, r: b.right, y: b.top, b: b.bottom } : null; };
  return { bar: r('.testbar'), left: r('.pill-left'), right: r('.pill-right') };
});
const apart = (a, b) => !a || !b || a.r <= b.x || b.r <= a.x || a.b <= b.y || b.b <= a.y;
check('the test-move bar does not cover either half of the top bar', !!boxes.bar && apart(boxes.bar, boxes.left) && apart(boxes.bar, boxes.right), JSON.stringify(boxes));
await dm.keyboard.press('m');

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
