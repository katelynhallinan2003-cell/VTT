// Round 6d: a hex grid printed on a map picture. Find it (pointy and flat), hide it, line the app's grid up with it, and square scenes that meet a hex map.
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
await dm.getByPlaceholder('New table name').fill('T');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);
await dm.locator('.dock-tabs button, .tabs button', { hasText: /^Scene$/ }).first().click().catch(() => {});

const S3 = Math.sqrt(3);
// a stony picture with hexes printed on it: pointy or flat, `p` between centres, hex-box top-left at (ox, oy), lines 2 px thick
const makeMap = (shape, p, ox, oy, W = 1600, H = 1200) => dm.evaluate(async ([shape, p, ox, oy, W, H]) => {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(W, H);
  let seed = 777;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = 150 + Math.sin(x / 37) * 18 + Math.cos(y / 53) * 14 + (rnd() - 0.5) * 40;
    const i = (y * W + x) * 4;
    id.data[i] = v; id.data[i + 1] = v * 0.93; id.data[i + 2] = v * 0.8; id.data[i + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  if (!shape) return c.toDataURL('image/png').split(',')[1];
  const R = p / Math.sqrt(3);
  ctx.strokeStyle = 'rgba(20,10,0,0.55)';
  ctx.lineWidth = 2;
  const pointy = shape === 'pointy';
  for (let r = -2; r < H / (pointy ? 1.5 * R : p) + 3; r++) {
    for (let q = -2; q < W / (pointy ? p : 1.5 * R) + 3; q++) {
      const cx = pointy ? ox + p / 2 + q * p + (r & 1) * p / 2 : ox + R + q * 1.5 * R;
      const cy = pointy ? oy + R + r * 1.5 * R : oy + p / 2 + r * p + (q & 1) * p / 2;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (pointy ? -90 : 0) * Math.PI / 180 + k * Math.PI / 3;
        const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }
  return c.toDataURL('image/png').split(',')[1];
}, [shape, p, ox, oy, W, H]);

const upload = async (b64, name, W = 1600) => {
  await dm.locator('.sect input[type=file]').first().setInputFiles({ name, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
  await dm.waitForFunction((W) => { const b = window.__vtt.board; const u = window.__vtt.client.scene.meta.mapUrl; return b.mapTex && b.mapTex.w === W && u && !u.includes('sample'); }, W, { timeout: 20000 });
  await sleep(500);
};
const meta = () => dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return { cut: m.mapGrid, grid: { ...m.grid }, scale: m.mapScale, mx: m.mapX, my: m.mapY }; });
const showing = () => dm.evaluate(() => { const b = window.__vtt.board; return !b.mapSprite ? 'none' : b.mapSprite.texture === b.mapCutTex && b.mapCutTex ? 'cut' : b.mapSprite.texture === b.mapTex?.texture ? 'original' : 'other'; });
const hexLattice = (cut, shape, p, ox, oy) => {
  // is the centre of the hex the finder describes one of the true hexes' centres (within 2 px)?
  const R = p / S3;
  const cx = cut.x + (shape === 'pointy' ? p / 2 : R), cy = cut.y + (shape === 'pointy' ? R : p / 2);
  const tx = ox + (shape === 'pointy' ? p / 2 : R), ty = oy + (shape === 'pointy' ? R : p / 2);
  const dx = cx - tx, dy = cy - ty;
  let best = 1e9;
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
    const vx = shape === 'pointy' ? a * p + (b & 1) * p / 2 : b * 1.5 * R;
    const vy = shape === 'pointy' ? b * 1.5 * R : a * p + (b & 1) * p / 2;
    best = Math.min(best, Math.hypot(dx - vx, dy - vy));
  }
  return best;
};
/** the darkness of the printed line pixels compared with the ground just off them, along one printed side, as drawn on screen */
const sideContrast = (p, ox, oy) => dm.evaluate(([p, ox, oy]) => {
  const b = window.__vtt.board;
  const res = b.mapSprite.texture.source.resource;
  if (!res) return null;
  const cv = document.createElement('canvas');
  cv.width = res.width || res.naturalWidth; cv.height = res.height || res.naturalHeight;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(res, 0, 0);
  const d = cx.getImageData(0, 0, cv.width, cv.height).data;
  const at = (x, y) => d[(Math.round(y) * cv.width + Math.round(x)) * 4];
  // the vertical sides of a pointy hex sit at x = ox + k*p/2 ... sample the ones at x = ox + k*p (full columns) between rows
  const R = p / Math.sqrt(3);
  let s = 0, n = 0;
  for (let k = 2; k < 14; k++) {
    const x = ox + k * p;
    const y = oy + R * 1.25 + 0 * 1.5 * R; // the middle of a vertical side of the hexes in the first row
    for (let row = 2; row < 6; row += 2) {
      const yy = y + row * 1.5 * R;
      s += (at(x - 7, yy) + at(x + 7, yy)) / 2 - at(x, yy);
      n++;
    }
  }
  return s / n;
}, [p, ox, oy]);

// ================= pointy hexes, scene set to the wrong grid on purpose
await upload(await makeMap('pointy', 90, 33, 21), 'hexmap.png');
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { shape: 'pointy', cell: 40, ox: 5, oy: 9 } }));
await sleep(300);
await dm.locator('.sect-head', { hasText: 'Grid printed on the map' }).click();
await dm.getByRole('button', { name: 'Find and hide it' }).waitFor();
check('hex scenes do not get the old "can\'t be hidden" message', (await dm.locator('.hint', { hasText: "can't be hidden yet" }).count()) === 0);
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 40000 });
let m = await meta();
check('it found pointy hexes', m.cut.hex === 'pointy', JSON.stringify(m.cut));
check('90 px between centres even though my grid was 40', Math.abs(m.cut.p - 90) < 0.5, String(m.cut.p));
check('on the right spot', hexLattice(m.cut, 'pointy', 90, 33, 21) < 2.2, String(hexLattice(m.cut, 'pointy', 90, 33, 21)));
check('about 2 px thick', m.cut.t >= 1 && m.cut.t <= 4, String(m.cut.t));
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 40000 });
check('the board now shows the copy without the hexes', (await showing()) === 'cut');
const after = await sideContrast(90, 33, 21);
check('the printed sides no longer stand out on screen', after !== null && Math.abs(after) < 14, String(after));
await dm.screenshot({ path: '/tmp/shots/t1-hidden.png' });
// switching off shows the original, where the lines do stand out
await dm.locator('label.toggle', { hasText: "Hide the map's grid lines" }).locator('input').uncheck();
await dm.waitForFunction(() => { const b = window.__vtt.board; return !b.mapCutTex && b.mapSprite.texture === b.mapTex.texture; }, null, { timeout: 10000 });
const before = await sideContrast(90, 33, 21);
check('with it off the original lines are there to see', before !== null && before > 15, String(before));
await dm.locator('label.toggle', { hasText: "Hide the map's grid lines" }).locator('input').check();
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 40000 });
// line the app's hexes up
await dm.getByRole('button', { name: 'Line my grid up with it' }).click();
await sleep(500);
m = await meta();
check("the app's hexes are now 90 px, point up", m.grid.shape === 'pointy' && Math.abs(m.grid.cell - 90) < 0.5, JSON.stringify(m.grid));
check('and sit on the printed ones', (() => {
  const g = m.grid; const R = 90 / S3;
  const dx = g.ox - 33, dy = g.oy - 21; let best = 1e9;
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) best = Math.min(best, Math.hypot(dx - (a * 90 + (b & 1) * 45), dy - b * 1.5 * R));
  return best < 2.2;
})(), `${m.grid.ox}, ${m.grid.oy}`);
check('the button goes away once they match', (await dm.getByRole('button', { name: 'Line my grid up with it' }).count()) === 0);
await dm.screenshot({ path: '/tmp/shots/t2-aligned.png' });

// the hex size slider is there and redoes the picture
await dm.locator('.sect-head', { hasText: 'Adjust the hiding' }).click();
check('hex scenes get a "Hex size" slider in the adjust section', (await dm.locator('.field', { hasText: 'Hex size' }).count()) >= 1);
await dm.evaluate(() => window.__vtt.client.updateScene({ mapGrid: { ...window.__vtt.client.scene.meta.mapGrid, t: 5 } }));
await sleep(900);
check('a different width is saved and the hex picture redone', (await meta()).cut.t === 5 && (await showing()) === 'cut' && (await meta()).cut.hex === 'pointy');

// ================= flat hexes, scene set to point-up hexes (the wrong way round)
await dm.getByRole('button', { name: 'Forget it' }).click();
await dm.waitForFunction(() => !window.__vtt.client.scene.meta.mapGrid, null, { timeout: 10000 });
await upload(await makeMap('flat', 80, 19, 27), 'flatmap.png');
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { shape: 'pointy', cell: 55, ox: 0, oy: 0 } }));
await sleep(300);
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 40000 });
m = await meta();
check('flat-top hexes are found even though the scene is set to point-up', m.cut.hex === 'flat', JSON.stringify(m.cut));
check('80 px between centres', Math.abs(m.cut.p - 80) < 0.5, String(m.cut.p));
check('on the right spot', hexLattice(m.cut, 'flat', 80, 19, 27) < 2.2, String(hexLattice(m.cut, 'flat', 80, 19, 27)));
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapCutTex && b.mapSprite.texture === b.mapCutTex; }, null, { timeout: 40000 });
await dm.getByRole('button', { name: 'Line my grid up with it' }).click();
await sleep(500);
m = await meta();
check('lining up switches the scene to flat-top hexes of the right size', m.grid.shape === 'flat' && Math.abs(m.grid.cell - 80) < 0.5, JSON.stringify(m.grid));
check('and the button goes away', (await dm.getByRole('button', { name: 'Line my grid up with it' }).count()) === 0);
await dm.screenshot({ path: '/tmp/shots/t3-flat.png' });

// ================= a square scene that meets a hex map
await dm.getByRole('button', { name: 'Forget it' }).click();
await dm.waitForFunction(() => !window.__vtt.client.scene.meta.mapGrid, null, { timeout: 10000 });
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { shape: 'square', cell: 50, ox: 0, oy: 0 } }));
await sleep(400);
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.meta.mapGrid, null, { timeout: 40000 });
m = await meta();
check('a square scene still finds the hexes on the picture', m.cut.hex === 'flat' && Math.abs(m.cut.p - 80) < 0.5, JSON.stringify(m.cut));
await dm.getByRole('button', { name: 'Line my grid up with it' }).click();
await sleep(500);
m = await meta();
check('and lining up turns the grid into hexes', m.grid.shape === 'flat' && Math.abs(m.grid.cell - 80) < 0.5, JSON.stringify(m.grid));

// ================= a square map still works on a hex scene, and says what it found
await dm.getByRole('button', { name: 'Forget it' }).click();
await dm.waitForFunction(() => !window.__vtt.client.scene.meta.mapGrid, null, { timeout: 10000 });
await upload(await makeMap(null, 0, 0, 0), 'plain.png');
await dm.getByRole('button', { name: 'Find and hide it' }).click();
await dm.locator('.toast', { hasText: /could not find/i }).last().waitFor({ timeout: 30000 });
check('a picture with no grid says so and changes nothing', (await meta()).cut === null && (await showing()) === 'original');

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
