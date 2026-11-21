// Token maker: brush-size cursor, erase paint vs erase image, and the magic wand.
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
await dm.getByPlaceholder('New table name').fill('G');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(300);

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
await sleep(400);
await dm.keyboard.press('e');
await dm.waitForSelector('.crop-stage');
await sleep(500);

check('the picture tools start tucked away for a token that has a picture', (await dm.locator('.modal .seg button', { hasText: 'Erase image' }).count()) === 0 && (await dm.locator('.modal .field-label, .modal label', { hasText: 'Ring thickness' }).count()) === 0);
check('but size and ring colour stay', (await dm.locator('.modal label, .modal .field-label', { hasText: /^Size/ }).count()) > 0);
await dm.locator('.modal .btn', { hasText: 'Picture tools' }).click();
await sleep(150);
const modeBtn = (t) => dm.locator('.modal .seg button', { hasText: new RegExp(`^${t}$`) });
const frame = async () => dm.locator('.modal .crop-frame').boundingBox();
const alphaAt = (sel, fx, fy) => dm.locator(`.modal ${sel}`).evaluate((c, [fx, fy]) => {
  const x = Math.round(fx * c.width), y = Math.round(fy * c.height);
  return c.getContext('2d').getImageData(x, y, 1, 1).data[3];
}, [fx, fy]);
const countAlpha = (sel) => dm.locator(`.modal ${sel}`).evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i]) n++;
  return n;
});
const at = async (fx, fy) => { const b = await frame(); return { x: b.x + fx * b.width, y: b.y + fy * b.height }; };
async function swipe(f0, f1, steps = 8) {
  const a = await at(...f0), b = await at(...f1);
  await dm.mouse.move(a.x, a.y); await dm.mouse.down(); await dm.mouse.move(b.x, b.y, { steps }); await dm.mouse.up();
}

check('opening the tools shows shape and ring thickness again', (await dm.locator('.modal', { hasText: 'Ring thickness' }).count()) === 1);
check('the editor has five tools', (await dm.locator('.modal .seg button').count()) >= 5);
for (const t of ['Move', 'Paint', 'Erase paint', 'Erase image', 'Auto select']) check(`has a ${t} button`, (await modeBtn(t).count()) === 1);

// brush-size circle instead of a cross
await modeBtn('Paint').click();
const p0 = await at(0.5, 0.5);
await dm.mouse.move(p0.x - 20, p0.y); await dm.mouse.move(p0.x, p0.y);
const cur = await dm.locator('.modal .brush-cursor').boundingBox();
check('painting shows a round brush cursor', !!cur && Math.abs(cur.width - cur.height) < 0.5);
check('and it sits under the mouse', !!cur && Math.abs(cur.x + cur.width / 2 - p0.x) < 2 && Math.abs(cur.y + cur.height / 2 - p0.y) < 2, `${cur && Math.round(cur.x + cur.width / 2 - p0.x)}`);
check('and the cross is gone', (await dm.locator('.modal .crop-stage').evaluate((e) => getComputedStyle(e).cursor)) === 'none');
const w1 = cur.width;
await dm.locator('.modal .brush-row input[type=range]').fill('100');
await dm.mouse.move(p0.x + 3, p0.y); await dm.mouse.move(p0.x, p0.y);
const w2 = (await dm.locator('.modal .brush-cursor').boundingBox()).width;
check('the circle grows with the brush size', w2 > w1 * 2, `${w1.toFixed(1)} -> ${w2.toFixed(1)}`);
await dm.locator('.modal .brush-row input[type=range]').fill('36');
await modeBtn('Move').click();
await dm.mouse.move(p0.x + 1, p0.y);
check('no brush circle in Move', (await dm.locator('.modal .brush-cursor').evaluate((e) => getComputedStyle(e).display)) === 'none');

// erase paint leaves the picture alone
await modeBtn('Paint').click();
await swipe([0.15, 0.5], [0.85, 0.5]);
const painted = await countAlpha('.paint-layer');
check('paint goes on the paint layer', painted > 1000, `${painted}px`);
await modeBtn('Erase paint').click();
await swipe([0.15, 0.5], [0.85, 0.5]);
check('erase paint removes the paint', (await countAlpha('.paint-layer')) < painted / 4);
check('and the picture is untouched', (await dm.locator('.modal .crop-frame > img').evaluate((e) => getComputedStyle(e).display)) !== 'none');

// erase image cuts holes in the picture itself
await modeBtn('Erase image').click();
await swipe([0.2, 0.3], [0.8, 0.3]);
await sleep(100);
const layerOk = await dm.locator('.modal .image-layer').evaluate((e) => getComputedStyle(e).display);
check('cutting switches to the cut-out picture layer', layerOk === 'block');
check('the swiped line is see-through', (await alphaAt('.image-layer', 0.5, 0.3)) === 0);
check('the rest of the picture is still there', (await alphaAt('.image-layer', 0.5, 0.8)) === 255);
await dm.screenshot({ path: '/tmp/shots/90-erase-image.png' });
await dm.locator('.modal .brush-row .btn', { hasText: 'Undo stroke' }).click();
await sleep(100);
check('undo puts the picture back', (await alphaAt('.image-layer', 0.5, 0.3)) === 255);
await swipe([0.2, 0.3], [0.8, 0.3]);
await dm.locator('.modal .brush-row .btn', { hasText: 'Restore image' }).click();
await sleep(100);
check('Restore image puts it all back', (await dm.locator('.modal .crop-frame > img').evaluate((e) => getComputedStyle(e).display)) !== 'none');

// magic wand
await modeBtn('Auto select').click();
const yellow = await at(0.25, 0.5);
await dm.mouse.click(yellow.x, yellow.y);
await sleep(100);
const sel1 = await countAlpha('.sel-layer');
check('clicking with the wand selects an area', sel1 > 20000 && sel1 < 200000, `${sel1}px`);
const insideSel = await alphaAt('.sel-layer', 0.25, 0.5), outsideSel = await alphaAt('.sel-layer', 0.95, 0.05);
check('the yellow is selected and the red is not', insideSel > 0 && outsideSel === 0, `${insideSel}/${outsideSel}`);
check('the selection shows what it is working on', (await dm.locator('.modal .sel-row').count()) === 1);
await dm.screenshot({ path: '/tmp/shots/91-wand.png' });

// painting stays inside the selection
await modeBtn('Paint').click();
await swipe([0.05, 0.1], [0.95, 0.9], 14);
await swipe([0.05, 0.9], [0.95, 0.1], 14);
check('paint lands inside the selection', (await alphaAt('.paint-layer', 0.25, 0.28)) > 0 && (await alphaAt('.paint-layer', 0.25, 0.72)) > 0);
check('and not outside it', (await alphaAt('.paint-layer', 0.75, 0.72)) === 0 && (await alphaAt('.paint-layer', 0.75, 0.28)) === 0);
// invert
await dm.locator('.modal .sel-row .btn', { hasText: 'Invert' }).click();
await sleep(100);
check('invert says it is working outside', (await dm.locator('.modal .sel-row').innerText()).includes('outside'));
await swipe([0.45, 0.85], [0.95, 0.85], 10);
check('painting while inverted lands outside the selection', (await alphaAt('.paint-layer', 0.75, 0.85)) > 0);
await modeBtn('Erase paint').click();
await swipe([0.05, 0.1], [0.95, 0.9], 14);
check('erase paint leaves the paint inside the selection alone', (await alphaAt('.paint-layer', 0.25, 0.28)) > 0);
await swipe([0.45, 0.85], [0.95, 0.85], 10);
check('and removes the paint outside it', (await alphaAt('.paint-layer', 0.75, 0.85)) === 0);
await dm.locator('.modal .sel-row .btn', { hasText: 'Invert' }).click();

// erase image honours the selection too
await modeBtn('Erase image').click();
await swipe([0.05, 0.5], [0.95, 0.5], 14);
check('erase image cuts only inside the selection', (await alphaAt('.image-layer', 0.25, 0.5)) === 0 && (await alphaAt('.image-layer', 0.9, 0.5)) === 255);
await dm.screenshot({ path: '/tmp/shots/92-wand-erase.png' });

// deselect, then drag the wand to set sensitivity live
await dm.locator('.modal .sel-row .btn', { hasText: 'Deselect' }).click();
await modeBtn('Restore image').count();
await dm.locator('.modal .brush-row .btn', { hasText: 'Restore image' }).click();
check('deselect clears the outline', (await dm.locator('.modal .sel-row').count()) === 0 && (await countAlpha('.sel-layer')) === 0);
await modeBtn('Auto select').click();
const seed = await at(0.25, 0.5);
await dm.mouse.move(seed.x, seed.y); await dm.mouse.down();
await dm.mouse.move(seed.x + 6, seed.y, { steps: 2 });
const small = await countAlpha('.sel-layer');
const smallSens = await dm.locator('.modal .brush-row .num').innerText();
await dm.mouse.move(seed.x + 120, seed.y, { steps: 10 });
const big = await countAlpha('.sel-layer');
const bigSens = await dm.locator('.modal .brush-row .num').innerText();
await dm.mouse.up();
check('dragging farther selects more', big > small * 1.5 && parseInt(bigSens) > parseInt(smallSens), `${smallSens} ${small}px -> ${bigSens} ${big}px`);
await dm.mouse.move(seed.x + 20, seed.y);
// the slider re-runs the selection
await dm.locator('.modal .brush-row input[type=range]').fill('0');
const zero = await countAlpha('.sel-layer');
check('the sensitivity slider updates the selection', zero < big);
await dm.screenshot({ path: '/tmp/shots/93-wand-drag.png' });

// the cut-out and paint are saved into the token picture
await modeBtn('Erase image').click();
await dm.locator('.modal .brush-row .btn', { hasText: 'Deselect' }).click();
await swipe([0.05, 0.9], [0.95, 0.9], 8);
check('the Save button lights up', await dm.locator('.modal-foot .btn.primary').isEnabled());
await dm.locator('.modal-foot .btn.primary').click();
await dm.waitForSelector('.modal', { state: 'detached', timeout: 8000 });
const img2 = await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id)?.img, id);
check('the cut-out is baked into a new picture', !!img2 && img2 !== tokenImg);
const hole = await dm.evaluate(async (u) => {
  const im = new Image(); im.crossOrigin = 'anonymous'; im.src = u; await im.decode();
  const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
  const x = c.getContext('2d'); x.drawImage(im, 0, 0);
  return { top: x.getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.9), 1, 1).data[3], mid: x.getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.3), 1, 1).data[3] };
}, img2);
check('the saved picture has a see-through stripe', hole.top === 0 && hole.mid === 255, JSON.stringify(hole));

console.log(errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)).join('\n') || 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.some((e) => /pageerror/.test(e)) ? 0 : 1);
