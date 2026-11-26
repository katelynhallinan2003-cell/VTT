// Detect walls: the walls printed on a map picture are found and added in one undoable step, 10 ft high.
// Also: dark rock that fades softly into a rocky fringe is outlined in a few long walls, and a picture with no flat wall colour says so.
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
await dm.getByPlaceholder('New table name').fill('Z12');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(600);


// the sample dungeon: light rooms cut out of dark rock. The colour is picked as solid areas, so walls run round each room.
await sleep(1200);
await dm.keyboard.press('b');
await dm.getByRole('button', { name: /Detect walls from the map/ }).click();
await dm.getByRole('dialog', { name: 'Detect walls' }).waitFor();
await dm.waitForFunction(() => /\d+ walls? found/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 30000 });
check('dark rock round rooms is recognised as solid areas', (await dm.getByRole('button', { name: 'Solid areas' }).getAttribute('class')).includes('on'));
const rn = parseInt((await dm.locator('.modal-foot').innerText()).match(/(\d+) walls? found/)[1], 10);
check('the rooms are outlined (a few dozen walls, not hundreds)', rn >= 20 && rn <= 120, String(rn));
await dm.getByRole('button', { name: 'Cancel' }).click();
await dm.keyboard.press('Escape');

// a plain floor, a room with thick dark walls and a divider, and a thin printed grid
const b64 = await dm.evaluate(async () => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#c9c4b8'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(120,120,120,0.9)'; x.lineWidth = 1;
  for (let g = 0; g <= W; g += 100) { x.beginPath(); x.moveTo(g + 0.5, 0); x.lineTo(g + 0.5, H); x.stroke(); }
  for (let g = 0; g <= H; g += 100) { x.beginPath(); x.moveTo(0, g + 0.5); x.lineTo(W, g + 0.5); x.stroke(); }
  x.strokeStyle = '#222'; x.lineWidth = 10; x.lineCap = 'square';
  x.strokeRect(200, 200, 1000, 600);
  x.beginPath(); x.moveTo(700, 200); x.lineTo(700, 800); x.stroke();
  return c.toDataURL('image/png').split(',')[1];
});
await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'room.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && !window.__vtt.client.scene.meta.mapUrl.includes('sample'); }, null, { timeout: 20000 });
await sleep(800);
await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return window.__vtt.client.updateScene({ mapX: 0, mapY: 0, mapScale: 1, grid: { ...m.grid, shape: 'square', cell: 100, ox: 0, oy: 0, snap: true } }); });
await sleep(500);
const before = await dm.evaluate(() => window.__vtt.client.wallsList().length);

if (!(await dm.getByRole('button', { name: /Detect walls from the map/ }).count())) await dm.keyboard.press('b');
await dm.getByRole('button', { name: /Detect walls from the map/ }).click();
await dm.getByRole('dialog', { name: 'Detect walls' }).waitFor();
await dm.waitForFunction(() => /walls? found/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 15000 });
const foot = await dm.locator('.modal-foot').innerText();
const n = parseInt(foot.match(/(\d+) walls? found/)[1], 10);
check('walls were found, and few of them (no printed grid, no stray bits)', n >= 6 && n <= 12, foot.replace(/\n/g, ' '));
check('they are drawn over the picture', (await dm.locator('.dw-over line').count()) === n);
await dm.screenshot({ path: '/tmp/shots/z12-detect.png' });
await dm.getByRole('button', { name: /^Add \d+ walls?$/ }).click();
await sleep(600);
const walls = await dm.evaluate(() => window.__vtt.client.wallsList().map((w) => ({ a: w.a, b: w.b, k: w.k, h: w.h, vis: w.vis, one: w.one })));
check('they were added', walls.length === before + n);
check('as plain walls 10 ft high that players can see', walls.every((w) => w.k === 'wall' && w.h === 10 && w.vis === true && w.one === 0));
const on = (p) => [[200, 200, 1200, 200], [1200, 200, 1200, 800], [1200, 800, 200, 800], [200, 800, 200, 200], [700, 200, 700, 800]].some(([x0, y0, x1, y1]) => {
  const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (x0 + t * dx), p.y - (y0 + t * dy)) < 12;
});
check('every wall end sits on a drawn wall', walls.every((w) => on(w.a) && on(w.b)), JSON.stringify(walls.slice(0, 2)));
check('ends snapped to grid corners', walls.every((w) => [w.a, w.b].every((p) => p.x % 100 === 0 && p.y % 100 === 0)));
const corners = ['200,200', '1200,200', '1200,800', '200,800', '700,200', '700,800'];
const ends = new Set(walls.flatMap((w) => [`${w.a.x},${w.a.y}`, `${w.b.x},${w.b.y}`]));
check('the room corners and the divider ends are all there', corners.every((c) => ends.has(c)), [...ends].join(' '));
await dm.keyboard.press('Control+z');
await sleep(500);
check('one Ctrl+Z takes them all back', (await dm.evaluate(() => window.__vtt.client.wallsList().length)) === before);

// dark rock with soft, ragged edges on a bluish floor (the kind a fixed setting swallows into the floor)
const softRock = await dm.evaluate(async () => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#2c4468'; x.fillRect(0, 0, W, H);
  let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let k = 0; k < 900; k++) { x.strokeStyle = `rgba(20,30,60,${0.15 + rnd() * 0.2})`; x.lineWidth = 2; x.beginPath(); const a = rnd() * 1400, b = rnd() * 1000; x.moveTo(a, b); x.lineTo(a + (rnd() - 0.5) * 60, b + (rnd() - 0.5) * 60); x.stroke(); }
  x.shadowColor = '#0a1038'; x.shadowBlur = 26;
  x.fillStyle = '#0a1038';
  x.beginPath(); x.moveTo(-40, -40); x.lineTo(500, -40); x.lineTo(520, 380); x.lineTo(380, 560); x.lineTo(420, 760); x.lineTo(240, 1040); x.lineTo(-40, 1040); x.closePath(); x.fill();
  x.beginPath(); x.moveTo(900, -40); x.lineTo(1440, -40); x.lineTo(1440, 1040); x.lineTo(1000, 1040); x.lineTo(1040, 700); x.lineTo(940, 420); x.closePath(); x.fill();
  return c.toDataURL('image/png').split(',')[1];
});
await dm.keyboard.press('Escape');
await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'rock.png', mimeType: 'image/png', buffer: Buffer.from(softRock, 'base64') });
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && !window.__vtt.client.scene.meta.mapUrl.includes('room'); }, null, { timeout: 20000 });
await sleep(800);
await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return window.__vtt.client.updateScene({ mapX: 0, mapY: 0, mapScale: 1, grid: { ...m.grid, shape: 'square', cell: 100, ox: 0, oy: 0, snap: false } }); });
await sleep(500);
if (!(await dm.getByRole('button', { name: /Detect walls from the map/ }).count())) await dm.keyboard.press('b');
await dm.getByRole('button', { name: /Detect walls from the map/ }).click();
await dm.getByRole('dialog', { name: 'Detect walls' }).waitFor();
await dm.waitForFunction(() => /\d+ walls? found/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 30000 });
const rockN = parseInt((await dm.locator('.modal-foot').innerText()).match(/(\d+) walls? found/)[1], 10);
check('soft dark rock is taken as solid areas, with no "not a clear colour" warning', (await dm.getByRole('button', { name: 'Solid areas' }).getAttribute('class')).includes('on') && (await dm.locator('.hint.warn').count()) === 0);
check('and outlined in a few long walls, not scraps', rockN >= 6 && rockN <= 40, String(rockN));
const sensNow = Number(await dm.locator('.modal .slider-field input[type=number], .modal input[type=number]').first().inputValue().catch(() => '0'));
check('the closeness setting was worked out from the picture (tight, not the old 22)', sensNow > 0 && sensNow < 15, String(sensNow));
await dm.screenshot({ path: '/tmp/shots/z12-softrock.png' });
await dm.getByRole('button', { name: /^Add \d+ walls?$/ }).click();
await sleep(600);
const rockWalls = await dm.evaluate(() => window.__vtt.client.wallsList().map((w) => ({ a: w.a, b: w.b })));
// every wall end lies on the soft edge of the dark rock: within a square of one of the two polygons' sides
const polys = [[[-40, -40], [500, -40], [520, 380], [380, 560], [420, 760], [240, 1040], [-40, 1040]], [[900, -40], [1440, -40], [1440, 1040], [1000, 1040], [1040, 700], [940, 420]]];
const nearEdge = (p) => polys.some((poly) => poly.some((q, i) => { const r = poly[(i + 1) % poly.length]; const dx = r[0] - q[0], dy = r[1] - q[1], t = Math.max(0, Math.min(1, ((p.x - q[0]) * dx + (p.y - q[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - (q[0] + t * dx), p.y - (q[1] + t * dy)) < 70; }));
check('their ends sit on the edge of the rock (within about half a square)', rockWalls.length > 0 && rockWalls.every((w) => nearEdge(w.a) && nearEdge(w.b)));
await dm.keyboard.press('Control+z');
await sleep(400);

// a picture with nothing flat to pick: grass and shadow
const grassy = await dm.evaluate(async () => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  let seed = 4; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  x.fillStyle = '#5a8232'; x.fillRect(0, 0, W, H);
  for (let k = 0; k < 9000; k++) { const v = Math.floor(rnd() * 70); x.fillStyle = `rgb(${60 + v},${100 + v},${30 + v / 2})`; x.fillRect(rnd() * W, rnd() * H, 6 + rnd() * 10, 6 + rnd() * 10); }
  for (let k = 0; k < 350; k++) { x.fillStyle = `rgba(10,30,10,${0.2 + rnd() * 0.4})`; x.beginPath(); x.arc(rnd() * W, rnd() * H, 8 + rnd() * 30, 0, 7); x.fill(); }
  return c.toDataURL('image/png').split(',')[1];
});
await dm.keyboard.press('Escape');
await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'grass.png', mimeType: 'image/png', buffer: Buffer.from(grassy, 'base64') });
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && /grass/.test(window.__vtt.client.scene.meta.mapUrl + 'grass'); }, null, { timeout: 20000 });
await sleep(1200);
if (!(await dm.getByRole('button', { name: /Detect walls from the map/ }).count())) await dm.keyboard.press('b');
await dm.getByRole('button', { name: /Detect walls from the map/ }).click();
await dm.getByRole('dialog', { name: 'Detect walls' }).waitFor();
await dm.waitForFunction(() => /(\d+ walls? found|No walls found|too many)/.test(document.querySelector('.modal-foot')?.textContent || ''), null, { timeout: 30000 });
check('a picture with no flat wall colour says so, in plain words', /colour also appears in the terrain/.test((await dm.locator('.hint.warn').first().innerText().catch(() => ''))));
await dm.screenshot({ path: '/tmp/shots/z12-grass.png' });
await dm.getByRole('button', { name: 'Cancel' }).click();

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
