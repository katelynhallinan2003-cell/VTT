// Round Z19: lights are plain props (no hit points, effects or height), a light whose marker is hidden still shines for players,
// and a gridless scene does not offer to light up the squares a template covers.
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
await dm.getByPlaceholder('New table name').fill('Z19');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);

const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const pl = await context.newPage();
watch(pl, 'pl', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await sleep(700);
await dm.bringToFront();

const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const tokenOf = (p, id) => p.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return t ? { hidden: t.hidden, name: t.name, light: t.light } : null; }, id);
const hasView = (p, id) => p.evaluate((i) => window.__vtt.board.views.has(i), id);
const lightsOn = (p) => p.evaluate(() => { const L = window.__vtt.board.lighting(); return L ? L.lights.length : -1; });

// ---- a placed light starts with its marker hidden
await dm.evaluate(() => { window.__vtt.client.updateScene({ light: { ambient: 'dark' } }); window.__vtt.ui.set({ dockTab: 'scene' }); });
await sleep(500);
await dm.locator('.sect-head', { hasText: 'Light and darkness' }).click().catch(() => {});
await sleep(300);
await dm.getByRole('button', { name: 'Place a light' }).click();
await dm.waitForFunction(() => [...window.__vtt.client.scene.tokens.values()].some((t) => t.shape === 'none' && t.light));
await sleep(500);
const lamp = await dm.evaluate(() => { const t = [...window.__vtt.client.scene.tokens.values()].find((x) => x.shape === 'none' && x.light); return t.id; });
check('a light you place starts with its marker hidden from players', (await tokenOf(dm, lamp)).hidden === true);
check('the hint says the light shines for everyone and the marker is only on your screen', (await dm.getByText('A placed light shines for everyone; its marker is only on your screen').count()) === 1);
await sleep(400);
check('the player has the light but no marker for it', (await tokenOf(pl, lamp)) !== null && (await hasView(pl, lamp)) === false && (await hasView(dm, lamp)) === true);
check('and its light shines for the player', (await lightsOn(pl)) === 1 && (await lightsOn(dm)) === 1, `${await lightsOn(pl)} / ${await lightsOn(dm)}`);
await dm.screenshot({ path: '/tmp/shots/z19-dm-light.png' });
await pl.screenshot({ path: '/tmp/shots/z19-player-light.png' });

// ---- the little bar for a light: only what it shines, its name and its marker
await dm.evaluate((id) => window.__vtt.ui.select([id]), lamp);
await sleep(400);
const tag = dm.locator('.tokentag');
check('a light has Edit and a marker button', (await tag.getByRole('button', { name: 'Edit', exact: true }).count()) === 1 && (await tag.getByRole('button', { name: 'Show marker' }).count()) === 1);
check('and no Height, Effects, Aura, library or hit points', (await tag.getByRole('button', { name: /^Height/ }).count()) === 0 && (await tag.getByRole('button', { name: /^Effects/ }).count()) === 0 && (await tag.getByRole('button', { name: /^Aura/ }).count()) === 0 && (await tag.getByRole('button', { name: /Save to library/ }).count()) === 0 && (await tag.locator('.tt-hp').count()) === 0);
check('the bar says the marker is hidden', /marker hidden/.test(await tag.locator('.tt-sub').innerText()));
await dm.screenshot({ path: '/tmp/shots/z19-lighttag.png' });
await tag.getByRole('button', { name: 'Edit', exact: true }).click();
const modal = dm.locator('.modal');
await modal.waitFor();
const text = await modal.innerText();
check('the light editor has its light, its name and the marker switch', /Light/.test(text) && (await modal.getByLabel('Hide the marker from players').count()) === 1 && (await modal.getByLabel('Locked in place').count()) === 1);
check('and no health, height, label or effects', !/Health|Hit points|Flying|Height|Who sees the name|Effects/i.test(text), text.slice(0, 200).replace(/\n/g, ' | '));
await dm.screenshot({ path: '/tmp/shots/z19-lighteditor.png' });
await modal.getByLabel('Hide the marker from players').uncheck();
await modal.getByRole('button', { name: 'Save', exact: true }).click();
await dm.waitForFunction((id) => window.__vtt.client.scene.tokens.get(id).hidden === false, lamp);
await sleep(500);
check('showing the marker gives the player the marker as well, and the light stays', (await hasView(pl, lamp)) === true && (await lightsOn(pl)) === 1);
await dm.locator('.tokentag').getByRole('button', { name: 'Hide marker' }).click();
await sleep(500);
check('hiding it again takes the marker away but not the light', (await hasView(pl, lamp)) === false && (await lightsOn(pl)) === 1 && (await tokenOf(dm, lamp)).hidden === true);
// a creature carrying a light is still gone when it is hidden
const ogre = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Ambusher', size: 1, hidden: true, light: { b: 20, d: 20, c: '#ffd9a0' } }), [grid.ox + 3.5 * grid.cell, grid.oy + 2.5 * grid.cell]);
await sleep(500);
check('a hidden creature that carries a light gives no light to the players', (await lightsOn(pl)) === 1 && (await tokenOf(pl, ogre)) === null);
check('and it still has hit points and effects on its bar', await (async () => { await dm.evaluate((id) => window.__vtt.ui.select([id]), ogre); await sleep(300); return (await dm.locator('.tokentag').getByRole('button', { name: /^Height/ }).count()) === 1 && (await dm.locator('.tokentag').getByRole('button', { name: /^Effects/ }).count()) === 1; })());
await dm.evaluate((id) => { window.__vtt.ui.select([]); return window.__vtt.client.removeTokens([id]); }, ogre);

// ---- lights that were hidden before this change are brought out where players can read them
await dm.evaluate(() => window.__vtt.client.updateScene({ light: { ambient: 'dark' } }));
const sid = await dm.evaluate(() => window.__vtt.client.scene.id);
await dm.evaluate(([tid, sid]) => window.__vtt.client.backend.update({ [`tables/${tid}/dm/scenes/${sid}/tokens/oldlamp`]: { name: 'Old lamp', x: 300, y: 300, size: 0.5, shape: 'none', label: 'dm', light: { b: 20, d: 20, c: '#ffd9a0' }, z: 9 } }), [tid, sid]);
await sleep(1000);
check('an old hidden light is moved so players get its light too', (await tokenOf(pl, 'oldlamp')) !== null && (await lightsOn(pl)) === 2, `${await lightsOn(pl)}`);
await dm.evaluate(() => window.__vtt.client.removeTokens(['oldlamp']));
await sleep(500);
check('and deleting a hidden light takes it from everyone', (await tokenOf(pl, 'oldlamp')) === null && (await tokenOf(dm, 'oldlamp')) === null);

// ---- #96: templates on a gridless scene
await dm.evaluate(() => { window.__vtt.ui.select([]); window.__vtt.ui.set({ dockTab: null, tool: 'template' }); });
await sleep(400);
const coverSwitch = () => dm.getByText(/Show the (squares|hexes) it covers/).count();
check('with a grid, covered squares are automatic', (await coverSwitch()) === 0 && await dm.evaluate(()=>window.__vtt.board.coverOn()));
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { visible: false, snap: false, rule: 'euclid' } }));
await sleep(500);
check('with no grid it does not', (await coverSwitch()) === 0);
check('and a template lights no squares, whatever the setting was', await dm.evaluate(() => window.__vtt.board.coverOn() === false));
await dm.screenshot({ path: '/tmp/shots/z19-gridless-template.png' });
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { visible: true, snap: true, rule: 'chebyshev' } }));
await sleep(500);
check('turn the grid back on and covered squares return', (await coverSwitch()) === 0 && await dm.evaluate(() => window.__vtt.board.coverOn()));

const real = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
