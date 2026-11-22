// Round 6f: the DM brings every player's view to the part of the map they are looking at.
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
await dm.getByPlaceholder('New table name').fill('V');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const join = async (name) => {
  const pl = await context.newPage();
  watch(pl, name, errors);
  await pl.goto(`${BASE}#/t/${tid}`);
  await pl.getByPlaceholder('e.g. Aria').fill(name);
  await pl.getByRole('button', { name: 'Join table' }).click();
  await pl.waitForSelector('.board-host canvas');
  await sleep(900);
  return pl;
};
const pl = await join('Aria');
await dm.bringToFront();

check('only the DM has the button', (await dm.getByRole('button', { name: 'Bring players here' }).count()) === 1 && (await pl.getByRole('button', { name: 'Bring players here' }).count()) === 0);

// the DM looks at a small part of the map
await dm.evaluate(() => { const b = window.__vtt.board; b.centerOn({ x: 600, y: 500 }); b.zoomBy(2.2); });
await sleep(300);
const want = await dm.evaluate(() => window.__vtt.board.viewRect());
const before = await pl.evaluate(() => window.__vtt.board.viewRect());
check('the player starts out looking at a bigger part of the map', before.w > want.w * 1.5, `${Math.round(before.w)} vs ${Math.round(want.w)}`);
await dm.getByRole('button', { name: 'Bring players here' }).click();
// (a page in the background only draws now and then, so wait for the glide to reach its end)
await pl.waitForFunction((w) => { const r = window.__vtt.board.viewRect(); return Math.abs(r.x + r.w / 2 - (w.x + w.w / 2)) < 3 && Math.abs(r.y + r.h / 2 - (w.y + w.h / 2)) < 3; }, want, { timeout: 8000 }).catch(() => {});
const got = await pl.evaluate(() => window.__vtt.board.viewRect());
const cx = (r) => r.x + r.w / 2, cy = (r) => r.y + r.h / 2;
check('the player\'s view is now centred on the same spot', Math.abs(cx(got) - cx(want)) < 8 && Math.abs(cy(got) - cy(want)) < 8, `${Math.round(cx(got))},${Math.round(cy(got))} vs ${Math.round(cx(want))},${Math.round(cy(want))}`);
check('and shows all of what the DM was looking at', got.w >= want.w - 4 && got.h >= want.h - 4 && got.w < want.w * 1.6, `${Math.round(got.w)} wide vs ${Math.round(want.w)}`);
check('the player is told', (await pl.locator('.toast', { hasText: /brought everyone/i }).count()) >= 1);
await pl.screenshot({ path: '/tmp/shots/v1-player.png' });

// the DM's own view does not move
const dmAfter = await dm.evaluate(() => window.__vtt.board.viewRect());
check('the DM\'s own view stays where it was', Math.abs(dmAfter.x - want.x) < 1 && Math.abs(dmAfter.w - want.w) < 1);

// someone who arrives later is not dragged to an old ask
const late = await join('Bram');
const lateView = await late.evaluate(() => window.__vtt.board.viewRect());
check('a player who joins afterwards is not moved by an old ask', lateView.w > want.w * 1.5, `${Math.round(lateView.w)}`);

// asking again somewhere else moves them again, even though it is the same size
await dm.bringToFront();
await dm.evaluate(() => window.__vtt.board.centerOn({ x: 1400, y: 900 }));
await sleep(200);
const want2 = await dm.evaluate(() => window.__vtt.board.viewRect());
await dm.getByRole('button', { name: 'Bring players here' }).click();
// a page in the background draws slowly, so wait for the glide to land instead of for a fixed time
const landed = (cxWant) => (p) => p.waitForFunction((w) => { const r = window.__vtt.board.viewRect(); return Math.abs(r.x + r.w / 2 - w) < 8; }, cxWant, { timeout: 10000 }).catch(() => null);
await landed(cx(want2))(pl); await landed(cx(want2))(late);
const got2 = await pl.evaluate(() => window.__vtt.board.viewRect());
const late2 = await late.evaluate(() => window.__vtt.board.viewRect());
check('asking again moves everyone again', Math.abs(cx(got2) - cx(want2)) < 8 && Math.abs(cx(late2) - cx(want2)) < 8, `${Math.round(cx(got2))}, ${Math.round(cx(late2))} vs ${Math.round(cx(want2))}`);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
