// Round 4a: temp hit points, sphere snap modes, covered squares, and fog that follows the path a token walks.
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
await dm.getByPlaceholder('New table name').fill('H');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

const tokens = () => dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()]);
const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const c = grid.cell;
const worldPt = (cx, cy) => ({ x: grid.ox + cx * c, y: grid.oy + cy * c });
const toScreen = (p) => dm.evaluate((p) => window.__vtt.board.worldToScreen(p), p);

// ---------------------------------------------------------------- temp hit points
const gob = await dm.evaluate(async ([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Goblin', size: 1, hp: 10, maxHp: 10 }), [worldPt(6.5, 6.5).x, worldPt(6.5, 6.5).y]);
const tok = async () => (await tokens()).find((t) => t.id === gob);
await dm.evaluate((id) => window.__vtt.client.giveTemp([id], 5), gob);
await sleep(150);
check('temp hit points are given', (await tok()).tempHp === 5);
await dm.evaluate((id) => window.__vtt.client.giveTemp([id], 3), gob);
await sleep(100);
check('a smaller amount does not replace a bigger one', (await tok()).tempHp === 5);
await dm.evaluate((id) => window.__vtt.client.damage([id], 7), gob);
await sleep(150);
let t = await tok();
check('damage eats temp hit points first', t.tempHp === 0 && t.hp === 8, `hp ${t.hp}, temp ${t.tempHp}`);
await dm.evaluate((id) => window.__vtt.client.giveTemp([id], 4), gob);
await dm.evaluate((id) => window.__vtt.client.damage([id], -10), gob);
await sleep(150);
t = await tok();
check('healing stops at the maximum and leaves temp hit points alone', t.hp === 10 && t.tempHp === 4, `hp ${t.hp}, temp ${t.tempHp}`);
await dm.evaluate(() => window.__vtt.client.undo?.());
await sleep(100);
await dm.evaluate((id) => window.__vtt.ui.select([id]), gob);
await sleep(200);
check('the token tag shows temp hit points', (await dm.locator('.tokentag .temp-hp').count()) === 1);
await dm.locator('.tokentag .tt-hp input').fill('9');
await dm.locator('.tokentag .tt-hp .btn', { hasText: 'Temp' }).click();
await sleep(200);
check('the Temp button gives temp hit points from the box', (await tok()).tempHp === 9);
await dm.keyboard.press('e');
await dm.waitForSelector('.modal');
check('the editor has a Temp HP box', (await dm.locator('.modal label, .modal .field-label', { hasText: 'Temp HP' }).count()) >= 1);
const optTexts = await dm.locator('.modal select option').allInnerTexts();
check('the health options say what players really see', optTexts.some((x) => x.startsWith('Nothing at all')) && optTexts.some((x) => x.includes('Colour only')) && optTexts.some((x) => x.includes('Colour and a health bar')));
await dm.keyboard.press('Escape');
await dm.locator('.modal-foot .btn', { hasText: 'Cancel' }).click().catch(() => {});
await sleep(200);

// ---------------------------------------------------------------- sphere snap modes
await dm.evaluate(() => window.__vtt.ui.select([]));
await dm.keyboard.press('c');
await dm.locator('.flyout .seg button', { hasText: 'Sphere' }).click();
check('the sphere shows its snap choices', (await dm.locator('.flyout .seg button', { hasText: 'Middle of a square' }).count()) === 1);
const draws = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()]);
async function dragSphere(from, to) {
  const a = await toScreen(from), b = await toScreen(to);
  await dm.mouse.move(a.x, a.y); await dm.mouse.down(); await dm.mouse.move(b.x, b.y, { steps: 6 }); await dm.mouse.up(); await sleep(250);
  const l = await draws();
  return l[l.length - 1].p.split(',').map(Number);
}
const rel = (p) => ({ u: (p[0] - grid.ox) / c, v: (p[1] - grid.oy) / c });
let p = await dragSphere(worldPt(11.3, 8.2), worldPt(13.6, 8.3));
let r = rel(p);
check('a sphere snaps to the middle of a square by default', Math.abs(r.u - 11.5) < 0.01 && Math.abs(r.v - 8.5) < 0.01, `${r.u.toFixed(2)},${r.v.toFixed(2)}`);
await dm.locator('.flyout .seg button', { hasText: 'Corner' }).click();
p = await dragSphere(worldPt(11.3, 11.2), worldPt(13.6, 11.3));
r = rel(p);
check('or to a corner when asked', Math.abs(r.u - 11) < 0.01 && Math.abs(r.v - 11) < 0.01, `${r.u.toFixed(2)},${r.v.toFixed(2)}`);
await dm.locator('.flyout .seg button', { hasText: 'Nothing' }).click();
p = await dragSphere(worldPt(11.3, 14.2), worldPt(13.64, 14.3));
r = rel(p);
const len = Math.hypot(p[2] - p[0], p[3] - p[1]) / c;
check('or nowhere: it goes exactly where it is put', Math.abs(r.u - 11.3) < 0.05 && Math.abs(r.v - 14.2) < 0.05 && Math.abs(len - Math.round(len)) > 0.03, `${r.u.toFixed(2)},${r.v.toFixed(2)} len ${len.toFixed(2)}`);
await dm.locator('.flyout .seg button', { hasText: 'Middle of a square' }).click();
check('the choice is remembered', (await dm.evaluate(() => localStorage.getItem('vtt-tpl-sphere'))) === 'center');

// ---------------------------------------------------------------- covered squares
check('showing the squares is on by default', (await dm.evaluate(() => window.__vtt.ui.data.tplCover)) === true);
await dm.evaluate(() => window.__vtt.client.clearDrawings(() => true, 'x'));
await sleep(200);
await dm.locator('.flyout .seg button', { hasText: 'Cone' }).click();
await dm.locator('.flyout .seg button', { hasText: 'Emanation' }).click();
await dragSphere(worldPt(14.5, 4.5), worldPt(16.6, 4.5));
await dm.locator('.flyout .seg button', { hasText: 'Cone' }).click();
await dragSphere(worldPt(11.05, 8.5), worldPt(14.0, 8.5));
await dm.keyboard.press('v');
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/100-covered-squares.png' });
await dm.evaluate(() => window.__vtt.ui.set({ tplCover: false }));
await sleep(300);
await dm.screenshot({ path: '/tmp/shots/101-uncovered.png' });
await dm.evaluate(() => window.__vtt.ui.set({ tplCover: true }));
await dm.evaluate(() => window.__vtt.client.clearDrawings(() => true, 'x'));

// ---------------------------------------------------------------- fog follows the real path
await dm.evaluate(() => window.__vtt.client.updateScene({ fog: { enabled: true, vision: true, explore: true } }));
const elf = await dm.evaluate(async ([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Elf', size: 1, sight: 15 }), [worldPt(8.5, 12.5).x, worldPt(8.5, 12.5).y]);
await sleep(1200);
const fogOps = () => dm.evaluate(() => [...window.__vtt.client.scene.fogOps.values()].filter((o) => o.t === 'line').map((o) => o.p.split(',').map(Number)));
const before = (await fogOps()).length;
await dm.evaluate((id) => window.__vtt.ui.select([id]), elf);
await sleep(150);
const a0 = await toScreen(worldPt(8.5, 12.5)), a1 = await toScreen(worldPt(12.5, 12.5)), a2 = await toScreen(worldPt(12.5, 15.5));
await dm.mouse.move(a0.x, a0.y); await dm.mouse.down();
await dm.mouse.move(a1.x, a1.y, { steps: 12 });
await sleep(120);
await dm.mouse.move(a2.x, a2.y, { steps: 12 });
await sleep(120);
await dm.mouse.up();
await sleep(1500);
const ops = await fogOps();
const added = ops.slice(before);
// Exploration may flush a stroke during the drag. Check the painted route across all writes.
const turn = worldPt(12.5, 12.5);
const samples = added.flatMap(line => line.filter((_,i) => i % 2 === 0).map((x,i) => ({x,y:line[2*i+1]})));
check('walking leaves a trail along the route', samples.length >= 3, JSON.stringify(samples));
const onRoute = p => Math.abs(p.y - turn.y) < c * 0.8 || Math.abs(p.x - turn.x) < c * 0.8;
const staysOnRoute = added.every(line => {
  for (let i = 2; i < line.length; i += 2) {
    if (!onRoute({x:(line[i]+line[i-2])/2,y:(line[i+1]+line[i-1])/2})) return false;
  }
  return true;
});
check('and it follows the corner instead of cutting across', staysOnRoute && samples.every(onRoute) &&
  samples.some(p => Math.hypot(p.x-turn.x,p.y-turn.y) < c*0.8));

// teleport: hold Q while dragging
const n1 = (await fogOps()).length;
const b0 = await toScreen(worldPt(12.5, 15.5)), b1 = await toScreen(worldPt(18.5, 15.5));
console.log('teleport drag', JSON.stringify([b0, b1, grid.cell]), JSON.stringify((await tokens()).find((q) => q.id === elf)));
await dm.keyboard.down('q');
await dm.mouse.move(b0.x, b0.y); await dm.mouse.down();
await dm.mouse.move(b1.x, b1.y, { steps: 12 });
await dm.mouse.up();
await sleep(100);
await dm.keyboard.up('q');
await sleep(1500);
const tele = (await fogOps()).slice(n1);
check('holding Q teleports: only where it lands is cleared', tele.length === 1 && tele[0].length === 2, JSON.stringify(tele.map((q) => q.length)));
const e = (await tokens()).find((q) => q.id === elf);
check('and the token did arrive', Math.abs(e.x - worldPt(18.5, 15.5).x) < c);

console.log(errors.filter((x) => !/GPU stall|ReadPixels|willReadFrequently/.test(x)).join('\n') || 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.some((x) => /pageerror/.test(x)) ? 0 : 1);
