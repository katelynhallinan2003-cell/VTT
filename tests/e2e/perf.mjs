import { launch, watch, sleep } from './lib.mjs';
const BASE = (process.env.BASE || 'http://127.0.0.1:5173/') + '?demo';
const errors = [];
const { browser, context } = await launch();
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('Perf');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');

// a big generated map (6000 x 4500 = 27 megapixels) with fine detail so mipmaps matter
const mapInfo = await dm.evaluate(async () => {
  const W = 6000, H = 4500;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#6b5d4a'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#000'; g.lineWidth = 2;
  for (let x = 0; x <= W; x += 100) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 100) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.fillStyle = '#fff'; g.font = '40px sans-serif';
  for (let x = 0; x < W; x += 500) for (let y = 0; y < H; y += 500) g.fillText(`${x / 100},${y / 100}`, x + 10, y + 50);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
  const t0 = performance.now();
  const url = URL.createObjectURL(blob);
  await window.__vtt.client.createScene({ name: 'Big', mapUrl: url, mapW: W, mapH: H, grid: { cell: 100 } });
  await new Promise((res) => { const t = setInterval(() => { if (window.__vtt.board.mapSprite) { clearInterval(t); res(); } }, 20); });
  return { ms: Math.round(performance.now() - t0), bytes: blob.size, tex: [window.__vtt.board.mapTex.texture.width, window.__vtt.board.mapTex.texture.height] };
});
console.log('big map loaded:', JSON.stringify(mapInfo));

// 300 tokens
await dm.evaluate(async () => {
  const c = window.__vtt.client;
  const ps = [];
  for (let i = 0; i < 300; i++) ps.push(c.addToken({ x: 150 + (i % 30) * 100, y: 150 + Math.floor(i / 30) * 100, name: `T${i}`, size: 1, ring: i % 2 ? '#ff6b6b' : '#4dabf7' }));
  await Promise.all(ps);
});
await dm.waitForFunction(() => window.__vtt.client.scene.tokens.size === 300);
await sleep(800);

// JS-side cost of a frame with everything moving (select all + keyboard nudges)
const stats = await dm.evaluate(async () => {
  const b = window.__vtt.board;
  window.__vtt.ui.select([...window.__vtt.client.scene.tokens.keys()]);
  const times = [];
  const orig = b.app.render.bind(b.app);
  let renderMs = 0, renders = 0;
  b.app.render = () => { const t = performance.now(); orig(); renderMs += performance.now() - t; renders++; };
  // wiggle the camera for 60 frames
  for (let i = 0; i < 60; i++) {
    const t = performance.now();
    b.cam.tx += 3; b.cam.zoom *= 1.002; b.applyCamera();
    b.frame(0.016);
    times.push(performance.now() - t);
    await new Promise((r) => requestAnimationFrame(r));
  }
  times.sort((a, z) => a - z);
  return { frames: times.length, medianMs: +times[30].toFixed(1), p95Ms: +times[57].toFixed(1), avgRenderMs: +(renderMs / Math.max(1, renders)).toFixed(1) };
});
console.log('300 tokens, camera moving (software GL, so GPU time is pessimistic):', JSON.stringify(stats));

// mass drag via the real pointer path
const res = await dm.evaluate(async () => {
  const b = window.__vtt.board;
  const t0 = performance.now();
  const ids = [...window.__vtt.client.scene.tokens.keys()];
  const moves = ids.map((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { id, x: t.x + 70, y: t.y + 70 }; });
  await window.__vtt.client.moveTokens(moves);
  return Math.round(performance.now() - t0);
});
console.log('writing 300 token moves in one update:', res, 'ms');
await dm.screenshot({ path: '/tmp/shots/30-perf.png' });
console.log(errors.filter((e) => !/GL Driver|404/.test(e)).join('\n') || 'no errors');
await browser.close();
