// Checks for the second round of feedback: undo, copy/paste, hold-to-ping, middle-drag pan,
// the simpler grid panel, the token list tab and the token picture tools.
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
await dm.getByPlaceholder('New table name').fill('B1');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

const state = () => dm.evaluate(() => {
  const { client } = window.__vtt;
  return { bg: client.scene?.meta?.bg, tokens: [...client.scene.tokens.values()].map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y, imgBg: t.imgBg, img: t.img })), canUndo: client.history.canUndo };
});
const toScreen = (wx, wy) => dm.evaluate(([x, y]) => {
  const b = window.__vtt.board;
  const r = b.app.canvas.getBoundingClientRect();
  const p = b.worldToScreen ? b.worldToScreen(x, y) : { x: b.cam.tx + x * b.cam.zoom, y: b.cam.ty + y * b.cam.zoom };
  return { x: r.left + p.x, y: r.top + p.y };
}, [wx, wy]);

// white drawing surface by default
check('scene background is white by default', (await state()).bg === '#ffffff');

// grid panel is simpler: sliders hidden until Fine-tune is opened
await sleep(150);
const visibleBefore = await dm.locator('.dock input[type=range]:visible').count();
check('grid sliders are tucked away by default', visibleBefore === 0, `visible sliders=${visibleBefore}`);
check('draw-a-box and snap stay visible', (await dm.locator('.dock >> text=Draw a box').count()) > 0 && (await dm.locator('.dock >> text=Snap tokens to grid').count()) > 0);
await dm.locator('.sect-head', { hasText: 'Fine-tune' }).click();
await sleep(150);
check('Fine-tune opens the square size sliders', (await dm.locator('.dock input[type=range]:visible').count()) > 0);
await dm.locator('.sect-head', { hasText: 'Fine-tune' }).click();
await dm.locator('.sect-head', { hasText: 'Distance rules' }).click();
await sleep(150);
check('distance rules hold feet per square and diagonals', (await dm.locator('.dock >> text=Diagonals').count()) > 0 || (await dm.locator('.dock >> text=diagonal').count()) > 0);
await dm.locator('.sect-head', { hasText: 'Distance rules' }).click();

// tokens + undo
const a = await dm.evaluate(() => window.__vtt.client.addToken({ x: 315, y: 315, name: 'Ogre', size: 2 }));
const b = await dm.evaluate(() => window.__vtt.client.addToken({ x: 525, y: 315, name: 'Rat', size: 0.5 }));
await sleep(400);
await dm.evaluate((id) => window.__vtt.ui.select([id]), a);
const p0 = await toScreen(315, 315);
await dm.mouse.move(p0.x, p0.y);
await dm.mouse.down();
await dm.mouse.move(p0.x + 90, p0.y + 40, { steps: 6 });
await dm.mouse.up();
await sleep(300);
const moved = (await state()).tokens.find((t) => t.id === a);
check('token dragged', moved.x !== 315 || moved.y !== 315, `${moved.x},${moved.y}`);
await dm.keyboard.press('Control+z');
await sleep(300);
const undone = (await state()).tokens.find((t) => t.id === a);
check('Ctrl+Z puts the token back', Math.abs(undone.x - 315) < 1 && Math.abs(undone.y - 315) < 1, `${undone.x},${undone.y}`);
await dm.keyboard.press('Control+y');
await sleep(300);
const redone = (await state()).tokens.find((t) => t.id === a);
check('Ctrl+Y redoes the move', redone.x === moved.x && redone.y === moved.y);
await dm.keyboard.press('Control+z');
await sleep(200);

// copy / paste / delete keys
await dm.evaluate((id) => window.__vtt.ui.select([id]), a);
const n0 = (await state()).tokens.length;
await dm.keyboard.press('Control+c');
await dm.mouse.move(700, 500);
await dm.keyboard.press('Control+v');
await sleep(400);
check('Ctrl+C then Ctrl+V adds a copy', (await state()).tokens.length === n0 + 1);
await dm.keyboard.press('Delete');
await sleep(300);
check('Delete removes the pasted copy', (await state()).tokens.length === n0);
await dm.keyboard.press('Control+z');
await sleep(300);
check('Ctrl+Z brings the deleted copy back', (await state()).tokens.length === n0 + 1);
await dm.keyboard.press('Control+z');
await sleep(300);
check('Ctrl+Z again undoes the paste', (await state()).tokens.length === n0);
check('no Duplicate / Delete buttons on the token tag', (await dm.locator('.tokentag button', { hasText: /^(Duplicate|Delete)$/ }).count()) === 0);

// moving the map can be undone too
await dm.evaluate(() => window.__vtt.client.updateScene({ mapLocked: false }));
const mapBefore = await dm.evaluate(() => window.__vtt.client.scene.meta.mapX);
await dm.evaluate((x) => window.__vtt.client.updateScene({ mapX: x + 200 }), mapBefore);
await sleep(200);
await dm.keyboard.press('Control+z');
await sleep(300);
check('Ctrl+Z undoes a map move', (await dm.evaluate(() => window.__vtt.client.scene.meta.mapX)) === mapBefore);
await dm.keyboard.press('Control+z'); // and the unlock
await sleep(200);

// middle mouse pans
const cam0 = await dm.evaluate(() => ({ ...window.__vtt.board.cam }));
await dm.mouse.move(900, 600);
await dm.mouse.down({ button: 'middle' });
await dm.mouse.move(980, 650, { steps: 5 });
await dm.mouse.up({ button: 'middle' });
await sleep(200);
const cam1 = await dm.evaluate(() => ({ ...window.__vtt.board.cam }));
check('middle-drag pans the view', Math.abs(cam1.tx - cam0.tx) > 40 && Math.abs(cam1.ty - cam0.ty) > 20, `${cam1.tx - cam0.tx},${cam1.ty - cam0.ty}`);

// hold to ping — on empty space and on a token
const pings = () => dm.evaluate(() => window.__vtt.board.pings.length);
const e0 = await pings();
await dm.mouse.move(1000, 300);
await dm.mouse.down();
await sleep(800);
await dm.mouse.up();
await sleep(200);
check('holding on empty map pings', (await pings()) > e0);
const tp = await toScreen(525, 315);
const e1 = await pings();
await dm.mouse.move(tp.x, tp.y);
await dm.mouse.down();
await sleep(800);
await dm.mouse.up();
await sleep(200);
const ratAfter = (await state()).tokens.find((t) => t.id === b);
check('holding on a token pings and does not move it', (await pings()) > e1 && ratAfter.x === 525 && ratAfter.y === 315);
const e2 = await pings();
await dm.mouse.move(tp.x, tp.y);
await dm.mouse.down();
await dm.mouse.move(tp.x + 70, tp.y, { steps: 5 });
await sleep(700);
await dm.mouse.up();
await sleep(200);
check('dragging a token does not ping', (await pings()) <= e2, `${e2} -> ${await pings()}`);
await dm.keyboard.press('Control+z');
await sleep(200);

// token list tab
await dm.locator('.dock-tabs button', { hasText: 'Tokens' }).click();
await sleep(200);
check('token list shows every token', (await dm.locator('.tok-list .tok-name').count()) === (await state()).tokens.length);
await dm.locator('.dock input[type=text]').first().fill('Ogre');
await sleep(150);
check('token list search filters', (await dm.locator('.tok-list .tok-name').count()) === 1);
await dm.locator('.dock input[type=text]').first().fill('');
await dm.screenshot({ path: '/tmp/shots/50-token-list.png' });
await dm.locator('.dock-tabs button', { hasText: 'Scene' }).click();

// token editor: colour behind the picture, paint, bake
await dm.evaluate((id) => window.__vtt.ui.select([id]), a);
await sleep(200);
await dm.locator('.tokentag button', { hasText: /Edit/ }).click();
await dm.waitForSelector('.modal .crop-frame');
check('editor has a Dropper button', (await dm.locator('.modal button', { hasText: 'Dropper' }).count()) > 0);
await dm.locator('.modal .crop-tools input[type=color]').last().evaluate((el) => {
  el.value = '#2f9e44';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(200);
const frameBg = await dm.locator('.modal .crop-frame').evaluate((el) => getComputedStyle(el).backgroundColor);
check('colour behind the picture shows in the frame', frameBg === 'rgb(47, 158, 68)', frameBg);
await dm.locator('.modal .seg button', { hasText: 'Paint' }).click();
const box = await dm.locator('.modal .crop-frame').boundingBox();
await dm.mouse.move(box.x + 40, box.y + 100);
await dm.mouse.down();
await dm.mouse.move(box.x + 160, box.y + 100, { steps: 8 });
await dm.mouse.move(box.x + 160, box.y + 160, { steps: 8 });
await dm.mouse.up();
const painted = await dm.locator('.modal .paint-layer').evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return n;
});
check('painting puts pixels on the paint layer', painted > 500, `${painted}px`);
await dm.screenshot({ path: '/tmp/shots/51-editor-paint.png' });
await dm.locator('.modal .seg button', { hasText: 'Erase' }).click();
const box2 = await dm.locator('.modal .crop-frame').boundingBox();
check('switching to Erase does not move the picture', Math.abs(box2.y - box.y) < 1 && Math.abs(box2.x - box.x) < 1, `${box.y} -> ${box2.y}`);
await dm.mouse.move(box.x + 40, box.y + 100);
await dm.mouse.down();
await dm.mouse.move(box.x + 160, box.y + 100, { steps: 8 });
await dm.mouse.up();
const afterErase = await dm.locator('.modal .paint-layer').evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return n;
});
check('erase removes paint', afterErase < painted, `${painted} -> ${afterErase}`);
await dm.locator('.modal .seg button', { hasText: 'Paint' }).click();
await dm.mouse.move(box.x + 100, box.y + 40);
await dm.mouse.down();
await dm.mouse.move(box.x + 100, box.y + 120, { steps: 6 });
await dm.mouse.up();
await dm.locator('.modal-foot .btn.primary').click();
await dm.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
await sleep(600);
const saved = (await state()).tokens.find((t) => t.id === a);
check('Save keeps the picture background colour', saved.imgBg === '#2f9e44', String(saved.imgBg));
check('Save bakes the painting into a new picture', !!saved.img && saved.img.startsWith('blob:'), String(saved.img).slice(0, 30));
await dm.screenshot({ path: '/tmp/shots/52-token-baked.png' });
await dm.keyboard.press('Control+z');
await sleep(300);
check('Ctrl+Z undoes the whole edit', (await state()).tokens.find((t) => t.id === a).imgBg !== '#2f9e44');

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
