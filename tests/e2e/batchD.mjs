// Layout cleanup, pan/ping settings, small fixes (round 3).
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
await dm.getByPlaceholder('New table name').fill('D');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');

// ---- first-run: no scene, one dropdown, no table name, no full-width bar
check('no full-width top bar any more', (await dm.locator('.topbar').count()) === 0);
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);

check('Scene panel opens by itself after the first scene is created', (await dm.locator('.dock.dock-scene').count()) === 1);
check('rail has Scene, Tokens, Players tabs', (await dm.locator('.rail-tab').allTextContents()).map((t) => t.replace(/\d+$/, '')).join(',') === 'Scene,Tokens,Players');
await dm.screenshot({ path: '/tmp/shots/60-layout-scene-open.png' });
await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
check('clicking the open tab folds the panel', (await dm.locator('.dock').count()) === 0);
check('only the little tabs remain on the right', (await dm.locator('.rail-tab').count()) === 3);
await dm.screenshot({ path: '/tmp/shots/61-layout-collapsed.png' });

// no "Scenes" button, no live text anywhere in the bar
check('no separate Scenes button', (await dm.locator('.pill button', { hasText: /^Scenes$/ }).count()) === 0);
const opts = await dm.locator('.scene-select option').allTextContents();
check('scene dropdown lists the scene, + New scene, Manage scenes', opts.length === 3 && opts[1].includes('New scene') && opts[2].includes('Manage'), JSON.stringify(opts));
check('no "live" text in the bar', !(await dm.locator('.pill').first().innerText()).toLowerCase().includes('live'));
await dm.locator('.scene-select').selectOption('__new');
check('+ New scene… opens the new-scene dialog', (await dm.locator('.modal-head', { hasText: 'New scene' }).count()) === 1);
await dm.keyboard.press('Escape');
await dm.locator('.scene-select').selectOption('__manage');
check('Manage scenes… opens the scenes dialog', (await dm.locator('.modal-head', { hasText: 'Scenes' }).count()) === 1);
await dm.keyboard.press('Escape');
await dm.getByRole('button', { name: 'Close' }).click().catch(() => {});

// ---- Players tab replaces the chip row
check('no player chips in the bar', (await dm.locator('.chip').count()) === 0);
await dm.locator('.rail-tab', { hasText: 'Players' }).click();
check('Players tab shows me and the at-table list', (await dm.locator('.dock-players .player-row').count()) >= 1);
await dm.screenshot({ path: '/tmp/shots/62-players-tab.png' });
await dm.locator('.rail-tab', { hasText: 'Tokens' }).click();
check('switching tabs swaps the panel', (await dm.locator('.dock.dock-tokens').count()) === 1 && (await dm.locator('.dock.dock-players').count()) === 0);

// ---- grid toggle replaces set-grid
const gridTool = dm.locator('.tool[aria-label*="grid"]');
check('toolbar has a grid toggle', (await gridTool.count()) === 1);
const vis0 = await dm.evaluate(() => window.__vtt.client.scene.meta.grid.visible);
await gridTool.click(); await sleep(200);
const vis1 = await dm.evaluate(() => window.__vtt.client.scene.meta.grid.visible);
check('grid toggle flips grid visibility', vis0 === true && vis1 === false, `${vis0} -> ${vis1}`);
await dm.mouse.move(700, 450);
await dm.keyboard.press('g'); await sleep(200);
check('G hotkey toggles the grid back', (await dm.evaluate(() => window.__vtt.client.scene.meta.grid.visible)) === true);
check('the tool is not a "draw a box" mode any more', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'select');

// ---- tokens tab: names not selectable, click still jumps
const cell = await dm.evaluate(() => window.__vtt.client.grid.cell);
await dm.evaluate((c) => window.__vtt.client.addToken({ x: 3.5 * c, y: 3.5 * c, name: 'Goblin' }), cell);
await dm.evaluate((c) => window.__vtt.client.addToken({ x: 9.5 * c, y: 6.5 * c, name: 'Ogre' }), cell);
await sleep(300);
const us = await dm.locator('.tok-list li').first().evaluate((el) => getComputedStyle(el).userSelect);
check('token rows are not text-selectable', us === 'none', us);
await dm.locator('.tok-list li', { hasText: 'Ogre' }).click();
await sleep(300);
const selName = await dm.evaluate(() => window.getSelection()?.toString() ?? '');
check('clicking a token row does not highlight its name', selName === '', JSON.stringify(selName));
check('clicking a token row still selects it', (await dm.evaluate(() => window.__vtt.ui.data.selection.size)) === 1);

// ---- token tag: no ctrl hint, Hide from players, aura
const tag = (await dm.locator('.tokentag').innerText());
check('token tag no longer shows the copy/delete hint', !/ctrl|copy|del/i.test(tag), JSON.stringify(tag));
check('token tag says "Hide from players"', (await dm.locator('.tokentag button', { hasText: 'Hide from players' }).count()) === 1);
await dm.locator('.tokentag button', { hasText: 'Hide from players' }).click(); await sleep(200);
check('hiding flips the label to "Show to players"', (await dm.locator('.tokentag button', { hasText: 'Show to players' }).count()) === 1);
await dm.locator('.tokentag button', { hasText: 'Show to players' }).click(); await sleep(200);
// aura from the tag, colour defaults to ring colour
await dm.evaluate(() => window.__vtt.client.updateToken([...window.__vtt.ui.data.selection][0], { ring: '#12ab34' }));
await dm.locator('.tokentag > button', { hasText: 'Aura' }).click();
await dm.locator('.tt-pop button', { hasText: '+ Add aura' }).click(); await sleep(300);
const aura = await dm.evaluate(() => { const t = window.__vtt.client.scene.tokens.get([...window.__vtt.ui.data.selection][0]); return t.auras[0]; });
check('aura added from the tag defaults to the ring colour', aura && aura.color.toLowerCase() === '#12ab34', JSON.stringify(aura));
await dm.screenshot({ path: '/tmp/shots/63-aura-pop.png' });
await dm.locator('.tokentag > button', { hasText: 'Aura' }).click();

// ---- scene panel: renamed section, no confirm on hide everything
await dm.locator('.rail-tab', { hasText: 'Scene' }).click();
check('"Fine tune grid" label', (await dm.locator('.sect-head', { hasText: 'Fine tune grid' }).count()) === 1);
let dialogs = 0;
dm.on('dialog', (d) => { dialogs++; d.accept(); });
await dm.locator('.dock button', { hasText: 'Hide everything' }).click(); await sleep(300);
check('Hide everything asks no question', dialogs === 0);
await dm.keyboard.press('Control+z'); await sleep(300);

// ---- mouse settings: default ping on middle, pan on right
const pings = () => dm.evaluate(() => window.__vtt.board.pings.length);
const ping0 = await pings();
await dm.mouse.move(800, 400);
await dm.mouse.down({ button: 'middle' }); await dm.mouse.up({ button: 'middle' }); await sleep(300);
const pingN = await pings();
check('middle click pings by default', pingN > ping0, `pings ${ping0} -> ${pingN}`);
const p0 = await dm.evaluate(() => ({ x: window.__vtt.board.cam.tx, y: window.__vtt.board.cam.ty }));
await dm.mouse.move(800, 400);
await dm.mouse.down({ button: 'right' }); await dm.mouse.move(700, 350, { steps: 5 }); await dm.mouse.up({ button: 'right' }); await sleep(250);
const p1 = await dm.evaluate(() => ({ x: window.__vtt.board.cam.tx, y: window.__vtt.board.cam.ty }));
check('right-drag pans by default', Math.abs(p1.x - p0.x - -100) < 3 && Math.abs(p1.y - p0.y - -50) < 3, `${p0.x},${p0.y} -> ${p1.x},${p1.y}`);
check('a plain right click still opens the menu', await (async () => { await dm.mouse.click(900, 500, { button: 'right' }); await sleep(200); const n = await dm.locator('.ctx').count(); await dm.keyboard.press('Escape'); await dm.mouse.click(900, 600); return n === 1; })());

// swap in settings
await dm.locator('.pill-right button', { hasText: 'Settings' }).click();
await dm.locator('.modal .seg button', { hasText: 'Middle mouse' }).click();
check('settings: Middle-click ping is disabled when pan is middle', await dm.locator('.modal .seg button', { hasText: 'Middle click' }).isDisabled());
await dm.keyboard.press('Escape');
const q0 = await dm.evaluate(() => ({ x: window.__vtt.board.cam.tx, y: window.__vtt.board.cam.ty }));
await dm.mouse.move(800, 400);
await dm.mouse.down({ button: 'middle' }); await dm.mouse.move(850, 440, { steps: 5 }); await dm.mouse.up({ button: 'middle' }); await sleep(250);
const q1 = await dm.evaluate(() => ({ x: window.__vtt.board.cam.tx, y: window.__vtt.board.cam.ty }));
check('middle-drag pans after swapping', Math.abs(q1.x - q0.x - 50) < 3 && Math.abs(q1.y - q0.y - 40) < 3, `${q0.x},${q0.y} -> ${q1.x},${q1.y}`);
check('settings persist', (await dm.evaluate(() => localStorage.getItem('vtt-pan-button'))) === 'middle');
const before = await pings();
await dm.mouse.move(700, 300);
await dm.mouse.down(); await sleep(900); await dm.mouse.up(); await sleep(300);
const after = await pings();
check('with middle-pan, holding the left mouse pings', after > before, `${before} -> ${after}`);

// the press ring must not draw a line across the page: sample the Graphics bounds while holding
await dm.evaluate(() => window.__vtt.ui.set({ panButton: 'right', pingMode: 'hold' }));
await dm.bringToFront();
await dm.mouse.move(700, 300);
await dm.mouse.down(); await sleep(500);
const ringBox = await dm.evaluate(() => { const b = window.__vtt.board; const r = b.overlayG.getBounds(); return { w: r.width, h: r.height }; });
await dm.mouse.up();
check('press ring stays small (no line across the page)', !ringBox || (ringBox.w < 120 && ringBox.h < 120), JSON.stringify(ringBox));

console.log(errors.filter((e) => !/GPU stall|ReadPixels/.test(e)).join('\n') || 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.some((e) => /pageerror/.test(e)) ? 0 : 1);
