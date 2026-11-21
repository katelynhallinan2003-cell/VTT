import { launch, watch, sleep } from './lib.mjs';

const BASE = (process.env.BASE || 'http://127.0.0.1:5173/') + '?demo';
const errors = [];
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

const { browser, context } = await launch();
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('Test table');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas', { timeout: 15000 });
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
check('DM created a table and opened it', tid.length >= 10, tid);
await dm.screenshot({ path: '/tmp/shots/01-dm-empty.png' });

// ---- scene with sample map
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.client?.scene?.meta?.mapUrl, null, { timeout: 15000 });
await sleep(1500);
const meta = await dm.evaluate(() => window.__vtt.client.scene.meta);
check('scene created with a map', meta.mapUrl && meta.mapW === 2240 && meta.mapH === 1540, `${meta.mapW}x${meta.mapH}`);
check('map texture loaded on the board', await dm.evaluate(() => !!window.__vtt.board.mapSprite));
await dm.screenshot({ path: '/tmp/shots/02-dm-map.png' });

// ---- add token through the UI
await dm.keyboard.press('t');
await dm.getByPlaceholder('Goblin 1').fill('Goblin 1');
await dm.getByRole('button', { name: 'Add to board' }).click();
await dm.waitForFunction(() => window.__vtt.client.scene.tokens.size === 1);
const tok = await dm.evaluate(() => [...window.__vtt.client.scene.tokens.values()][0]);
check('token added via UI, snapped to grid', tok.name === 'Goblin 1' && Math.abs(((tok.x - 35) % 70)) < 0.01, `x=${tok.x} y=${tok.y}`);

// ---- second token + drag with the mouse
const tid2 = await dm.evaluate(async () => { const c = window.__vtt.client; const b = window.__vtt.board; const p = b.viewCenterWorld(); return c.addToken({ x: Math.round(p.x / 70) * 70 + 35 + 140, y: Math.round(p.y / 70) * 70 + 35, name: 'Fighter', size: 1, ring: '#4dabf7' }); });
await sleep(300);
const startPos = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); const b = window.__vtt.board; const r = b.app.canvas.getBoundingClientRect(); return { sx: r.left + t.x * b.cam.zoom + b.cam.tx, sy: r.top + t.y * b.cam.zoom + b.cam.ty, x: t.x, y: t.y, z: b.cam.zoom }; }, tid2);
await dm.mouse.move(startPos.sx, startPos.sy);
await dm.mouse.down();
const dxScreen = 3 * 70 * startPos.z + 10;
for (let i = 1; i <= 10; i++) await dm.mouse.move(startPos.sx + (dxScreen * i) / 10, startPos.sy + (30 * i) / 10);
await dm.mouse.up();
await sleep(300);
const moved = await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id), tid2);
check('dragging a token moves it and snaps to the grid', moved.x > startPos.x + 150 && Math.abs((moved.x - 35) % 70) < 0.01 && Math.abs((moved.y - 35) % 70) < 0.01, `from ${startPos.x},${startPos.y} to ${moved.x},${moved.y}`);

// ---- player joins
const pl = await context.newPage();
watch(pl, 'player', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas', { timeout: 15000 });
await pl.waitForFunction(() => window.__vtt?.client?.scene?.tokens?.size === 2, null, { timeout: 15000 });
await sleep(1200);
check('player sees the live scene and both tokens', true);
check('player sees the map texture', await pl.evaluate(() => !!window.__vtt.board.mapSprite));
await pl.screenshot({ path: '/tmp/shots/03-player-claim.png' });
// the claim dialog opens automatically; take the Fighter
await pl.locator('.lib-item', { hasText: 'Fighter' }).click();
await sleep(300);
const owner = await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id).ownerUid, tid2);
const plUid = await pl.evaluate(() => window.__vtt.client.uid);
check('player claimed a token and the DM sees the owner', owner === plUid);

// ---- live move sync: DM -> player and player -> DM
await dm.evaluate((id) => window.__vtt.client.moveTokens([{ id, x: 35 + 70 * 12, y: 35 + 70 * 8 }]), tid2);
await sleep(400);
const seenByPlayer = await pl.evaluate((id) => window.__vtt.client.scene.tokens.get(id), tid2);
check('DM move reaches the player', seenByPlayer.x === 35 + 70 * 12 && seenByPlayer.y === 35 + 70 * 8);
await pl.evaluate((id) => window.__vtt.client.moveTokens([{ id, x: 35 + 70 * 5, y: 35 + 70 * 5 }]), tid2);
await sleep(400);
const seenByDm = await dm.evaluate((id) => window.__vtt.client.scene.tokens.get(id), tid2);
check('player move on own token reaches the DM', seenByDm.x === 35 + 70 * 5);

// ---- permissions: standard = player may not move the DM goblin
await dm.evaluate(() => window.__vtt.client.setPermissions({ playersMoveAnyToken: false, playersCreateTokens: true, playersDeleteAnyToken: false, playersPing: true, playersDraw: true, playersMeasure: true }));
await sleep(300);
const gobId = tok.id;
const gob = await pl.evaluate((id) => { const c = window.__vtt.client; return { move: c.canDo('move', c.scene.tokens.get(id)), mine: c.canDo('move', c.scene.tokens.get(arguments[0])) }; }, gobId).catch(() => null);
const canMoveGoblin = await pl.evaluate((id) => { const c = window.__vtt.client; return c.canDo('move', c.scene.tokens.get(id)); }, gobId);
const canMoveOwn = await pl.evaluate((id) => { const c = window.__vtt.client; return c.canDo('move', c.scene.tokens.get(id)); }, tid2);
check('standard preset: player cannot move DM token but can move own', !canMoveGoblin && canMoveOwn);
void gob;

// ---- hidden token: invisible to players, visible to DM
const hid = await dm.evaluate(() => window.__vtt.client.addToken({ x: 35 + 70 * 8, y: 35 + 70 * 3, name: 'Ambusher', hidden: true }));
await sleep(400);
const dmSees = await dm.evaluate((id) => window.__vtt.client.scene.tokens.has(id), hid);
const plSees = await pl.evaluate((id) => window.__vtt.client.scene.tokens.has(id), hid);
check('hidden token: DM sees it, player does not', dmSees && !plSees);
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { hidden: false }), hid);
await sleep(400);
check('revealing a hidden token makes it appear for the player', await pl.evaluate((id) => window.__vtt.client.scene.tokens.has(id), hid));
await dm.evaluate((id) => window.__vtt.client.updateToken(id, { hidden: true }), hid);
await sleep(400);
check('re-hiding removes it from the player again', !(await pl.evaluate((id) => window.__vtt.client.scene.tokens.has(id), hid)));

// ---- fog of war
await dm.evaluate(() => window.__vtt.client.resetFog('hidden'));
await sleep(400);
await dm.evaluate(() => window.__vtt.client.addFogOp({ m: 'r', t: 'rect', p: '140,140,700,560' }));
await dm.evaluate(() => window.__vtt.client.addFogOp({ m: 'r', t: 'poly', p: '1200,200,1700,260,1600,700,1150,640' }));
await dm.evaluate(() => window.__vtt.client.addFogOp({ m: 'r', t: 'line', p: '300,1000,900,1100,1500,1100', w: 140 }));
await sleep(700);
check('fog ops sync to player', (await pl.evaluate(() => window.__vtt.client.scene.fogOps.size)) === 3);
await dm.screenshot({ path: '/tmp/shots/04-dm-fog.png' });
await pl.screenshot({ path: '/tmp/shots/05-player-fog.png' });

// ---- ping with middle click
const pingBefore = await pl.evaluate(() => window.__vtt.board.pings.length);
await dm.mouse.click(700, 450, { button: 'middle' });
await sleep(500);
const pingAfter = await pl.evaluate(() => window.__vtt.board.pings.length);
check('middle-click ping appears on the player screen', pingAfter > pingBefore, `${pingBefore} -> ${pingAfter}`);
await pl.screenshot({ path: '/tmp/shots/06-player-ping.png' });

// ---- scenes: private scene prep, then switch players over
const s1 = await dm.evaluate(() => window.__vtt.client.viewSceneId);
const s2 = await dm.evaluate(() => window.__vtt.client.createScene({ name: 'Second scene', makeActive: false }));
await sleep(500);
check('new private scene does not move players', (await pl.evaluate(() => window.__vtt.client.viewSceneId)) === s1);
await dm.evaluate((id) => window.__vtt.client.setActiveScene(id), s2);
await sleep(700);
check('showing the scene switches players over', (await pl.evaluate(() => window.__vtt.client.viewSceneId)) === s2);
await dm.evaluate((id) => window.__vtt.client.setActiveScene(id), s1);
await sleep(700);
check('switching back restores tokens for the player', (await pl.evaluate(() => window.__vtt.client.scene.tokens.size)) >= 2);

// ---- grid calibration
await dm.evaluate((id) => window.__vtt.client.openScene(id), s1);
await sleep(300);
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { cell: 70, ox: 0, oy: 0 } }));
const g = await dm.evaluate(() => { const geo = null; return window.__vtt.client.scene.meta.grid; });
check('grid settings persisted', g.cell === 70);

console.log('\nconsole problems:\n' + (errors.length ? errors.join('\n') : '(none)'));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
