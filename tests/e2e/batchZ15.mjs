// Round Z15: the ruler labels every step; spell templates as difficult ground; auto lights; light marks.
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
await dm.getByPlaceholder('New table name').fill('Z15');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { ...window.__vtt.client.scene.meta.grid, rule: 'chebyshev', ft: 5 } }));
await sleep(300);

const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = grid.cell;
const gx = (i) => grid.ox + i * cell;
const gy = (j) => grid.oy + j * cell;
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const labels = () => dm.evaluate(() => window.__vtt.board.plotLabels.filter((l) => l && l.visible).map((l) => l.text));
const drag = async (a, b) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await dm.mouse.move(q.x, q.y, { steps: 5 });
  await dm.mouse.up();
  await sleep(250);
};

// ---- #57: the ruler shows the distance at every step, the first one too
await dm.evaluate(() => window.__vtt.ui.set({ rulerMulti: true }));
await dm.keyboard.press('r');
await drag([gx(10.5), gy(10.5)], [gx(14.5), gy(10.5)]);
let l = await labels();
check('one leg: its distance', l.some((t) => /^20 ft/.test(t)) && l.length === 1, JSON.stringify(l));
await drag([gx(14.5), gy(10.5)], [gx(14.5), gy(13.5)]);
l = await labels();
check('two legs: the first leg\'s distance is on its corner, the total at the end', l.includes('20 ft') && l.some((t) => /^35 ft/.test(t)) && l.length === 2, JSON.stringify(l));
await drag([gx(14.5), gy(13.5)], [gx(11.5), gy(13.5)]);
l = await labels();
check('three legs: every corner has the distance so far', l.includes('20 ft') && l.includes('35 ft') && l.some((t) => /^50 ft/.test(t)) && l.length === 3, JSON.stringify(l));
await dm.screenshot({ path: '/tmp/shots/z15-ruler.png' });
// right-click takes the ruler away (with the ruler tool still on, so no menu opens), then back to the select tool
{ const q = await screen(gx(10.5), gy(10.5)); await dm.mouse.click(q.x, q.y, { button: 'right' }); }
await sleep(200);
await dm.keyboard.press('Escape');

// ---- #56: a spell template marked as difficult ground slows walking while it is there
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'template', tplKind: 'sphere' }));
const roughSwitch = dm.locator('.flyout label', { hasText: 'Counts as difficult ground' }).locator('input');
check('the template panel has "Counts as difficult ground", off to start with', (await roughSwitch.count()) === 1 && !(await roughSwitch.isChecked()));
const roughAt = (gxv, gyv) => dm.evaluate(([x, y]) => window.__vtt.board.isRoughAt({ x, y }), [gx(gxv), gy(gyv)]);
const costOf = (path) => dm.evaluate((pts) => window.__vtt.board.moveCost(pts, false), path.map(([i, j]) => ({ x: gx(i), y: gy(j) })));
await drag([gx(12.5), gy(6.5)], [gx(14.5), gy(6.5)]);
await sleep(300);
const spheres = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].filter((d) => d.k === 'sphere').length);
check('a template was placed', (await spheres()) === 1, JSON.stringify(await dm.evaluate(() => ({ tool: window.__vtt.ui.data.tool, kinds: [...window.__vtt.client.scene.draws.values()].map((d) => d.k) }))));
check('an ordinary template leaves the ground alone', !(await roughAt(12.5, 6.5)) && (await costOf([[8.5, 6.5], [17.5, 6.5]])).ft === 45);
await dm.keyboard.press('Control+z');
await sleep(400);
check('and undone', (await spheres()) === 0);
await roughSwitch.check();
await drag([gx(12.5), gy(6.5)], [gx(14.5), gy(6.5)]);
await sleep(300);
check('a marked template makes the squares it covers difficult', (await roughAt(12.5, 6.5)) && (await roughAt(13.5, 6.5)) && !(await roughAt(17.5, 6.5)));
const through = await costOf([[8.5, 6.5], [17.5, 6.5]]);
check('and a walk through it pays the extra', through.ft > 45 && /difficult ground/.test(through.note), JSON.stringify(through));
await dm.screenshot({ path: '/tmp/shots/z15-rough-template.png' });
// the selected template has the same switch, and turning it off lifts the ground
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
const tplId = await dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].find((d) => d.k === 'sphere').id);
await dm.evaluate((id) => window.__vtt.ui.selectDrawings([id]), tplId);
const tag = dm.locator('.drawtag label', { hasText: 'Difficult ground' }).locator('input');
await tag.waitFor();
check('a selected template shows the switch, on', await tag.isChecked());
await tag.uncheck();
await sleep(400);
check('switching it off makes the ground ordinary again', !(await roughAt(12.5, 6.5)) && (await costOf([[8.5, 6.5], [17.5, 6.5]])).ft === 45);
await tag.check();
await sleep(400);
check('and on again', await roughAt(12.5, 6.5));
await dm.keyboard.press('Delete');
await sleep(400);
check('deleting the template takes the difficult ground with it', !(await roughAt(12.5, 6.5)));
await dm.keyboard.press('Control+z');
await sleep(500);
check('undo brings both back', await roughAt(12.5, 6.5));

// ---- #60: a light is its own kind of token
await dm.evaluate(() => window.__vtt.ui.set({ tool: 'select' }));
await dm.locator('.dock-tabs button, .tabs button', { hasText: /^Scene$/ }).first().click().catch(() => {});
const placeBtn = dm.getByRole('button', { name: 'Place a light' });
if (!(await placeBtn.isVisible().catch(() => false))) await dm.locator('.sect-head', { hasText: 'Light and darkness' }).click();
await placeBtn.waitFor();
await placeBtn.click();
await sleep(500);
const lightId = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].find((t) => t.light)?.id);
check('Place a light adds a light', !!lightId);
const ttag = dm.locator('.tokentag');
await ttag.waitFor();
const tagButtons = (await ttag.locator('button').allInnerTexts()).map((t) => t.trim());
check('a selected light\'s tag has Edit and a marker button, but no Height, Effects, Aura or Save to library', tagButtons.includes('Edit') && tagButtons.some((t) => /marker$/i.test(t)) && !tagButtons.some((t) => /^(Height|Effects|Aura|Save)/.test(t)), JSON.stringify(tagButtons));
check('and says what it shines instead of a size', /bright/.test(await ttag.locator('.tt-sub').innerText()));
await ttag.getByRole('button', { name: 'Edit', exact: true }).click();
const editor = dm.getByRole('dialog');
await editor.waitFor();
const heads = (await editor.locator('h4').allInnerTexts()).map((t) => t.trim().toLowerCase());
const labelsOf = (await editor.locator('.field-label, label').allInnerTexts()).join(' | ');
check('the light editor is titled Edit light', /Edit light/.test(await editor.locator('.modal-title, h2, h3').first().innerText()));
check('it offers only the light, hiding the marker and locking: no height or health', heads.includes('light') && !heads.includes('height') && !heads.includes('health') && /Hide the marker from players/.test(labelsOf) && !/Flying/.test(labelsOf), JSON.stringify(heads) + ' ' + labelsOf.slice(0, 200));
check('and none of what only a creature uses: picture, ring, size, shape, sight, darkvision, initiative, auras, control', (await editor.locator('canvas').count()) === 0
  && !/Size|Ring|Shape|Sees as far|Darkvision|Initiative|Controlled by|Aura/i.test(labelsOf + ' ' + heads.join(' ')), labelsOf.slice(0, 300));
await dm.screenshot({ path: '/tmp/shots/z15-light-editor.png' });
await editor.getByRole('button', { name: 'Cancel' }).click();
// an ordinary token still has everything
const creature = await dm.evaluate(() => window.__vtt.client.addToken({ x: 175, y: 175, name: 'Orc', size: 1 }));
await dm.evaluate((id) => window.__vtt.ui.select([id]), creature);
await dm.locator('.tokentag').getByRole('button', { name: 'Edit', exact: true }).click();
const editor2 = dm.getByRole('dialog');
await editor2.waitFor();
const labels2 = (await editor2.locator('.field-label, label, h4').allInnerTexts()).join(' | ');
check('an ordinary token\'s editor still has size, ring, control and initiative', /Size/.test(labels2) && /Ring/.test(labels2) && /Controlled by/.test(labels2) && /Initiative/.test(labels2), labels2.slice(0, 200));
await editor2.getByRole('button', { name: 'Cancel' }).click();
await dm.evaluate(([a, b]) => window.__vtt.client.removeTokens([a, b]), [lightId, creature]);
await sleep(300);

// ---- #59: auto-add lights
const room = [[gx(4), gy(4), gx(10), gy(4)], [gx(10), gy(4), gx(10), gy(10)], [gx(10), gy(10), gx(4), gy(10)], [gx(4), gy(10), gx(4), gy(4)]];
await dm.evaluate((r) => window.__vtt.client.addWalls(r.map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by }, k: 'wall', open: false, vis: false, one: 0, h: 10 })), 'Walls for a test room'), room);
await sleep(400);
await dm.getByRole('button', { name: 'Auto-add lights…' }).click();
const dlg = dm.getByRole('dialog', { name: 'Auto-add lights' });
await dlg.waitFor();
await dm.waitForFunction(() => /light/.test(document.querySelector('.modal-foot')?.textContent || '') && !/Working/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 15000 });
const foot = (await dm.locator('.modal-foot').innerText()).replace(/\n/g, ' ');
check('it proposes a light for the closed room', /1 light|2 lights/.test(foot), foot);
const nDots = await dm.locator('.al-dot').count();
check('and draws it over the map', nDots >= 1 && nDots === (await dm.locator('.al-reach').count()), String(nDots));
await dm.screenshot({ path: '/tmp/shots/z15-autolights.png' });
await dm.getByRole('button', { name: /^Add \d+ lights?$/ }).click();
await sleep(600);
const added = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].filter((t) => t.light && t.shape === 'none').map((t) => ({ x: t.x, y: t.y, name: t.name })));
check('Add puts real lights in the room', added.length >= 1 && added.every((l) => l.x > gx(4) && l.x < gx(10) && l.y > gy(4) && l.y < gy(10) && l.name === 'Torch'), JSON.stringify(added));
await dm.keyboard.press('Control+z');
await sleep(500);
check('one Ctrl+Z takes them all back', (await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].filter((t) => t.light).length)) === 0);
await dm.keyboard.press('Control+y');
await sleep(500);
check('and Ctrl+Y puts them back', (await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].filter((t) => t.light).length)) === added.length);
// a room that already has a light is left alone
await dm.getByRole('button', { name: 'Auto-add lights…' }).click();
await dm.getByRole('dialog', { name: 'Auto-add lights' }).waitFor();
await dm.waitForFunction(() => /Nothing to add|light/.test(document.querySelector('.modal-foot')?.textContent || '') && !/Working/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 15000 });
check('a second run finds the room already lit', /Nothing to add/.test(await dm.locator('.modal-foot').innerText()));
await dm.getByRole('button', { name: 'Cancel' }).click();

// lamps drawn on the picture: three torches on a plain floor, and an orange rug that is not one
await dm.evaluate(async () => { const c = window.__vtt.client; await c.removeWalls(c.wallsList().map((w) => w.id)); await c.removeTokens([...c.scene.tokens.values()].filter((t) => t.light).map((t) => t.id)); });
const lampPic = await dm.evaluate(async () => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#707070'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffaa28';
  for (const [px, py] of [[250, 250], [850, 450], [1150, 750]]) { x.beginPath(); x.arc(px, py, 12, 0, Math.PI * 2); x.fill(); }
  x.fillRect(300, 600, 400, 250); // a rug
  return c.toDataURL('image/png').split(',')[1];
});
await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'lamps.png', mimeType: 'image/png', buffer: Buffer.from(lampPic, 'base64') });
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && !window.__vtt.client.scene.meta.mapUrl.includes('sample'); }, null, { timeout: 20000 });
await sleep(800);
await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return window.__vtt.client.updateScene({ mapX: 0, mapY: 0, mapScale: 1, grid: { ...m.grid, shape: 'square', cell: 100, ox: 0, oy: 0, snap: true } }); });
await sleep(500);
await dm.getByRole('button', { name: 'Auto-add lights…' }).click();
await dm.getByRole('dialog', { name: 'Auto-add lights' }).waitFor();
await dm.waitForFunction(() => /light/.test(document.querySelector('.modal-foot')?.textContent || '') && !/Working/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 15000 });
check('three torches on the picture are found, and the rug is not', /3 found/.test(await dm.locator('.modal').innerText()) && /3 lights/.test(await dm.locator('.modal-foot').innerText()), (await dm.locator('.modal-foot').innerText()).replace(/\n/g, ' '));
await dm.getByLabel(/Lamps and torches on the picture/).uncheck();
await dm.waitForFunction(() => /Nothing to add/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 10000 });
check('and turning that off leaves nothing (no walls, so no rooms)', true);
await dm.getByLabel(/Lamps and torches on the picture/).check();
await dm.getByRole('button', { name: /^Add 3 lights$/ }).click();
await sleep(600);
const lamp = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()].filter((t) => t.light).map((t) => [Math.round(t.x), Math.round(t.y)]).sort((a, b) => a[0] - b[0]));
check('the lights land on the torches', lamp.length === 3 && Math.abs(lamp[0][0] - 250) <= 6 && Math.abs(lamp[0][1] - 250) <= 6 && Math.abs(lamp[2][0] - 1150) <= 6, JSON.stringify(lamp));
await dm.screenshot({ path: '/tmp/shots/z15-lamps.png' });

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
