// Round Z18: group hit points, the grid settings in the Scene tab, a grid of its own on each added map.
import { launch, watch, sleep } from './lib.mjs';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const python = process.platform === 'win32' ? 'python' : 'python3';
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
await dm.getByPlaceholder('New table name').fill('Z18');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(600);

const grid = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = grid.cell;
const gx = (i) => grid.ox + i * cell;
const gy = (j) => grid.oy + j * cell;
const screen = (wx, wy) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [wx, wy]);
const drag = async (a, b) => {
  const p = await screen(a[0], a[1]), q = await screen(b[0], b[1]);
  await dm.mouse.move(p.x, p.y);
  await dm.mouse.down();
  await dm.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
  await dm.mouse.move(q.x, q.y, { steps: 5 });
  await dm.mouse.up();
  await sleep(300);
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
/** look at a spot of the board at full size, clear of the panel on the right */
const view = async (wx, wy) => { await dm.evaluate(([x, y]) => { const b = window.__vtt.board; b.cam.zoom = 1; b.centerOn({ x, y }); }, [wx - 150, wy]); await sleep(350); };
const tok = (id) => dm.evaluate((i) => { const t = window.__vtt.client.scene.tokens.get(i); return t ? { hp: t.hp, max: t.maxHp, temp: t.tempHp } : null; }, id);

// ---- #89: select several tokens and give them damage, healing or temporary hit points together
const add = (name, i, hp) => dm.evaluate(([n, x, y, h]) => window.__vtt.client.addToken({ x, y, name: n, size: 1, ...(h ? { hp: h, maxHp: h } : {}) }), [name, gx(i + 0.5), gy(3.5), hp]);
const g1 = await add('Goblin A', 2, 20), g2 = await add('Goblin B', 4, 20), g3 = await add('Goblin C', 6, 20), pillar = await add('Pillar', 8, 0);
await sleep(700);
await dm.evaluate((ids) => window.__vtt.ui.select(ids), [g1]);
await sleep(300);
check('one token with hit points has no group button', (await dm.getByRole('button', { name: 'Group HP', exact: true }).count()) === 0);
await dm.evaluate((ids) => window.__vtt.ui.select(ids), [g1, g2, g3, pillar]);
await sleep(300);
const gbtn = dm.getByRole('button', { name: 'Group HP', exact: true });
check('several selected tokens get a Group HP button', (await gbtn.count()) === 1);
await gbtn.click();
const pop = dm.getByRole('dialog', { name: 'Hit points for the selected tokens' });
await pop.waitFor();
check('it lists the tokens that have hit points, not the pillar', (await pop.locator('li').count()) === 3 && (await pop.getByText('Pillar').count()) === 0);
await pop.getByLabel('How many hit points').fill('14');
await sleep(150);
check('every row shows what it will have afterwards', (await pop.locator('.gh-next').allInnerTexts()).every((t) => /→ 6/.test(t)), JSON.stringify(await pop.locator('.gh-next').allInnerTexts()));
await pop.locator('li', { hasText: 'Goblin B' }).getByRole('button', { name: '½' }).click();
await sleep(150);
check('a token that saved takes half', /→ 13/.test(await pop.locator('li', { hasText: 'Goblin B' }).locator('.gh-next').innerText()));
await pop.locator('li', { hasText: 'Goblin C' }).getByRole('checkbox').uncheck();
await sleep(150);
check('and a token that is unticked is left out', (await pop.locator('li', { hasText: 'Goblin C' }).locator('.gh-next').innerText()).trim() === '' && (await pop.getByRole('button', { name: 'Apply to 2' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z18-grouphp.png' });
await pop.getByRole('button', { name: 'Apply to 2' }).click();
await sleep(600);
const [ha, hb, hc] = [await tok(g1), await tok(g2), await tok(g3)];
check('damage went to the ticked tokens, half to the one that saved', ha.hp === 6 && hb.hp === 13 && hc.hp === 20, JSON.stringify([ha, hb, hc]));
check('the box is empty and ready for the next number', (await pop.getByLabel('How many hit points').inputValue()) === '');
await dm.keyboard.press('Control+z');
await sleep(600);
check('Ctrl+Z puts them all back in one step', (await tok(g1)).hp === 20 && (await tok(g2)).hp === 20);
await pop.locator('li', { hasText: 'Goblin C' }).getByRole('checkbox').check();
await pop.getByRole('button', { name: 'Damage', exact: true }).click();
await pop.getByLabel('How many hit points').fill('9');
await pop.getByLabel('How many hit points').press('Enter');
await sleep(500);
check('Enter applies, to all three when all are ticked (the one that saved still takes half)', (await tok(g1)).hp === 11 && (await tok(g2)).hp === 16 && (await tok(g3)).hp === 11, JSON.stringify([await tok(g1), await tok(g2), await tok(g3)]));
await pop.getByRole('button', { name: 'Heal', exact: true }).click();
await pop.getByLabel('How many hit points').fill('4');
await pop.getByRole('button', { name: 'Apply to 3' }).click();
await sleep(500);
check('Heal gives back the whole amount to all of them, saved or not', (await tok(g1)).hp === 15 && (await tok(g2)).hp === 20 && (await tok(g3)).hp === 15, JSON.stringify([await tok(g1), await tok(g2), await tok(g3)]));
await pop.getByRole('button', { name: 'Heal', exact: true }).click();
await pop.getByLabel('How many hit points').fill('100');
await pop.getByLabel('How many hit points').press('Enter');
await sleep(500);
check('and never past the maximum, and the half marks do nothing when healing', (await tok(g1)).hp === 20 && (await tok(g2)).hp === 20 && (await pop.locator('li', { hasText: 'Goblin B' }).getByRole('button', { name: '½' }).isDisabled()));
await pop.getByRole('button', { name: 'Temp HP', exact: true }).click();
await pop.getByLabel('How many hit points').fill('5');
await pop.getByLabel('How many hit points').press('Enter');
await sleep(500);
check('Temp HP gives temporary hit points to the ticked tokens', (await tok(g1)).temp === 5 && (await tok(g2)).temp === 5 && (await tok(g3)).temp === 5);
await pop.getByRole('button', { name: 'Damage', exact: true }).click();
await pop.getByLabel('How many hit points').fill('8');
await pop.getByLabel('How many hit points').press('Enter');
await sleep(500);
check('and they soak up damage first', (await tok(g1)).hp === 17 && (await tok(g1)).temp === 0 && (await tok(g2)).hp === 20 && (await tok(g2)).temp === 1, JSON.stringify([await tok(g1), await tok(g2)]));
// Shift-click in the Tokens tab adds to the selection, and does it again to take one out
await dm.evaluate(() => window.__vtt.ui.set({ dockTab: 'tokens' }));
await dm.evaluate(() => window.__vtt.ui.select([]));
await sleep(300);
await dm.locator('.tok-list li', { hasText: 'Goblin A' }).click();
await dm.locator('.tok-list li', { hasText: 'Goblin B' }).click({ modifiers: ['Shift'] });
await sleep(200);
check('Shift-click in the Tokens tab adds tokens to the selection', await dm.evaluate(() => window.__vtt.ui.data.selection.size === 2));
await dm.locator('.tok-list li', { hasText: 'Goblin B' }).click({ modifiers: ['Shift'] });
await sleep(200);
check('and takes one out again', await dm.evaluate(() => window.__vtt.ui.data.selection.size === 1));
await dm.evaluate(() => window.__vtt.ui.set({ dockTab: null }));

// ---- #90: the Grid settings in the Scene tab
await dm.evaluate(() => { window.__vtt.ui.select([]); window.__vtt.ui.set({ dockTab: 'scene' }); });
await sleep(400);
const gridSect = dm.locator('section.sect', { has: dm.locator('> .sect-head', { hasText: /^▾Grid$/ }) });
check('the Grid section is open', (await gridSect.count()) === 1);
const heads = await gridSect.locator('.sect-head').allInnerTexts();
const headLow = heads.map((h) => h.replace(/^[▸▾]\s*/, '').toLowerCase());
check('the everyday controls come first and the rarer ones are folded under them', headLow.join('|') === 'grid|grid printed on the map|fine tune grid|distance rules', JSON.stringify(heads));
for (const name of ['Grid printed on the map', 'Fine tune grid', 'Distance rules']) {
  check(`"${name}" is folded until it is opened`, (await dm.locator('.sect-head', { hasText: name }).getAttribute('aria-expanded')) === 'false');
}
const order = await gridSect.first().evaluate((el) => {
  const body = el.querySelector(':scope > .sect-body');
  const find = (re) => { const all = [...body.querySelectorAll('.field-label, .toggle-text, .sect-head, button.btn')]; return all.findIndex((n) => re.test(n.textContent)); };
  return ['Grid type', 'Show grid', 'Snap tokens to grid', 'Grid colour', 'Fit the grid to the map', 'Grid printed on the map', 'Fine tune grid', 'Distance rules'].map((t) => find(new RegExp('^[▸▾]?\\s*' + t, 'i')));
});
check('in the order: type, show, snap, colour, fit to the map, then the folded ones', order.every((n) => n >= 0) && order.every((n, i) => i === 0 || n > order[i - 1]), JSON.stringify(order));
await dm.locator('.sect-head', { hasText: 'Fine tune grid' }).click();
check('opening Fine tune shows the square size, the offsets and the opacity', (await dm.getByText('Offset left / right').count()) === 1 && (await dm.getByText('Grid opacity').count()) === 1);
await dm.locator('.sect-head', { hasText: 'Fine tune grid' }).click();
check('each of the three ways to fit the grid is a button of its own', (await dm.getByRole('button', { name: 'Find and hide it' }).count()) === 1 && (await dm.getByRole('button', { name: 'Set scale with two points' }).count()) === 1 && (await dm.getByRole('button', { name: 'Draw a box to set the grid' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z18-gridpanel.png' });

// ---- #91, #92, #93: an added empty grid has squares, colour, paper and a switch of its own
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { color: '#ff0000', opacity: 1 } }));
const mid = await dm.evaluate(() => window.__vtt.client.addBlankGrid(6, 4));
await dm.waitForFunction(() => window.__vtt.client.scene.meta.maps.length === 1);
await sleep(500);
const mp = () => dm.evaluate(() => ({ ...window.__vtt.client.scene.meta.maps[0] }));
const m = await mp();
const mapsPanel = dm.locator('.extra-map');
check('the added empty grid has a "Show the grid here" switch', (await mapsPanel.getByLabel('Show the grid here').count()) === 1 && await mapsPanel.getByLabel('Show the grid here').isChecked());
check('a square size and a paper colour of its own', (await mapsPanel.getByText('Square size here').count()) === 1 && (await mapsPanel.getByLabel('Paper colour of this empty grid').count()) === 1);
check('and its squares are counted across and down', (await mapsPanel.getByLabel('Squares across').inputValue()) === '6' && (await mapsPanel.getByLabel('Squares down').inputValue()) === '4');

/** how red or green the screen is near a world point (the strongest pixel in a small square) */
const tint = (pts) => {
  return dm.evaluate((ps) => ps.map((p) => window.__vtt.board.worldToScreen({ x: p[0], y: p[1] })), pts).then(async (sp) => {
    await dm.screenshot({ path: '/tmp/shots/z18-px.png' });
    const code = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
out = []
for x, y in json.loads(sys.argv[2]):
    best = [0, 0]
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            r, g, b = im.getpixel((int(round(x)) + dx, int(round(y)) + dy))
            best[0] = max(best[0], r - max(g, b)); best[1] = max(best[1], g - max(r, b))
    out.append(best)
print(json.dumps(out))`;
    return JSON.parse(execFileSync(python, ['-c', code, '/tmp/shots/z18-px.png', JSON.stringify(sp.map((q) => [q.x, q.y]))]).toString());
  });
};
const colourAt = async (wx, wy) => {
  const sp = await screen(wx, wy);
  await dm.screenshot({ path: '/tmp/shots/z18-px2.png' });
  const code = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
print(','.join(str(v) for v in im.getpixel((int(round(float(sys.argv[2]))), int(round(float(sys.argv[3])))))))`;
  return execFileSync(python, ['-c', code, '/tmp/shots/z18-px2.png', String(sp.x), String(sp.y)]).toString().trim().split(',').map(Number);
};
// the scene's red lines run across the added grid too (it has nothing of its own yet), on its own spots 70 px apart
const sceneLineX = m.x + 70, ownLineX = m.x + 50, ly = m.y + 105;
await view(m.x + 100, m.y + 100);
let [[lr1, lg1], [lr2, lg2]] = await tint([[sceneLineX, ly], [ownLineX, ly]]);
check('with nothing set, the added grid shows the scene grid (red lines 70 px apart)', lr1 > 100 && lr2 < 40, JSON.stringify([[lr1, lg1], [lr2, lg2]]));

// squares of 50 px and green lines: the red ones go, green ones come, in the same patch
await mapsPanel.getByLabel('Square size here').last().fill('50');
await mapsPanel.getByLabel('Square size here').last().press('Enter');
await sleep(500);
await mapsPanel.getByLabel('Grid colour on this map').fill('#00ff00');
await sleep(600);
const m2 = await mp();
check('square size and colour are saved on that map only', m2.gs === 50 && m2.gc === '#00ff00' && (await dm.evaluate(() => window.__vtt.client.grid.cell)) === cell);
check('it kept its six by four squares at the new size', m2.w === 300 && m2.h === 200 && (await mapsPanel.getByLabel('Squares across').inputValue()) === '6' && (await mapsPanel.getByLabel('Squares down').inputValue()) === '4', `${m2.w}x${m2.h}`);
[[lr1, lg1], [lr2, lg2]] = await tint([[sceneLineX, ly], [ownLineX, ly]]);
check('its own green lines are 50 px apart and the scene\'s red ones are gone from it', lg2 > 100 && lr1 < 40 && lg1 < 40, JSON.stringify([[lr1, lg1], [lr2, lg2]]));
await view(gx(3), gy(2));
const [[rOut]] = await tint([[gx(3), gy(2)]]);
check('the rest of the scene keeps its own grid', rOut > 100, String(rOut));
await view(m.x + 100, m.y + 100);
check('the buttons to go back to the scene\'s are there', (await mapsPanel.getByRole('button', { name: 'Same as the scene' }).count()) === 1 && (await mapsPanel.getByRole('button', { name: 'Same square size as the scene' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z18-mapgrid.png' });

// a token on it is as big as one of its squares, and is put down in the middle of one
const cx = m.x + 25 + 50, cy = m.y + 25 + 50;
const mouse = await dm.evaluate(([x, y]) => window.__vtt.client.addToken({ x, y, name: 'Mouse', size: 1 }), [cx, cy]);
await sleep(600);
const hits = await dm.evaluate(([x, y]) => [window.__vtt.board.hitToken({ x: x + 20, y }), window.__vtt.board.hitToken({ x: x + 40, y })].map((t) => !!t), [cx, cy]);
check('a token on it is 50 px wide, not 70', hits[0] === true && hits[1] === false, JSON.stringify(hits));
await drag([cx, cy], [cx + 62, cy + 3]);
const spot = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { x: t.x, y: t.y }; }, mouse);
check('dragging it snaps to the middle of that map\'s squares', near(((spot.x - m.x) / 50) % 1, 0.5, 0.02) && near(((spot.y - m.y) / 50) % 1, 0.5, 0.02) && spot.x > cx + 30, JSON.stringify(spot));
const big = await dm.evaluate(() => window.__vtt.client.addToken({ x: 100, y: 100, name: 'Ogre', size: 1 }));
await sleep(500);
await view(100 + cell, 100);
await drag([100, 100], [100 + 2 * cell + 5, 100]);
const back = await dm.evaluate((id) => { const t = window.__vtt.client.scene.tokens.get(id); return { x: t.x, y: t.y }; }, big);
check('on the main map the scene\'s squares still count', near(((back.x - grid.ox) / cell) % 1, 0.5, 0.02), JSON.stringify(back));

// the switch, apart from the rest of the scene
await view(m.x + 100, m.y + 100);
await mapsPanel.getByLabel('Show the grid here').uncheck();
await sleep(500);
const m3 = await mp();
[[lr1, lg1], [lr2, lg2]] = await tint([[sceneLineX, ly], [ownLineX, ly]]);
await view(gx(3), gy(2));
const [[rMain]] = await tint([[gx(3), gy(2)]]);
await view(m.x + 100, m.y + 100);
check('turning it off there takes the lines off that map only', m3.gv === false && lg2 < 40 && lr1 < 40 && rMain > 100, JSON.stringify({ gv: m3.gv, lr1, lg2, rMain }));
check('and the controls for its squares and colour fold away', (await mapsPanel.getByText('Square size here').count()) === 0);
await mapsPanel.getByLabel('Show the grid here').check();
await sleep(500);
check('turning it on again brings its own lines back', (await mp()).gv === undefined && (await tint([[ownLineX, ly]]))[0][1] > 100);

// the paper of an empty grid
await mapsPanel.getByLabel('Paper colour of this empty grid').fill('#203060');
await sleep(600);
const paper = await colourAt(m.x + 12, m.y + 12);
check('the paper colour of the empty grid can be changed', Math.abs(paper[0] - 0x20) < 8 && Math.abs(paper[1] - 0x30) < 8 && Math.abs(paper[2] - 0x60) < 8, JSON.stringify(paper));
check('with a way back to the one picked to suit the lines', (await mapsPanel.getByRole('button', { name: 'Pick it to suit the lines' }).count()) === 1);
await dm.screenshot({ path: '/tmp/shots/z18-paper.png' });

// a player sees the same
const pl = await context.newPage();
watch(pl, 'player', errors);
await pl.goto(BASE);
check('(the map\'s own grid is part of the scene the players get)', await dm.evaluate(() => { const m = window.__vtt.client.scene.meta.maps[0]; return m.gs === 50 && m.gc === '#00ff00' && m.gp === '#203060'; }));
await pl.close();

// and everything goes back to the scene's grid with the reset buttons
await mapsPanel.getByRole('button', { name: 'Same as the scene' }).click();
await mapsPanel.getByRole('button', { name: 'Same square size as the scene' }).click();
await mapsPanel.getByRole('button', { name: 'Pick it to suit the lines' }).click();
await sleep(700);
const m4 = await mp();
check('Same as the scene puts squares, colour and paper back', m4.gs === undefined && m4.gc === undefined && m4.gp === undefined && m4.w === 6 * cell && m4.h === 4 * cell, JSON.stringify(m4));
[[lr1, lg1], [lr2, lg2]] = await tint([[m.x + 70, ly], [m.x + 50, ly]]);
check('and it shows the scene\'s grid again', lr1 > 100 && lr2 < 40, JSON.stringify([[lr1, lg1], [lr2, lg2]]));
await dm.evaluate(() => window.__vtt.client.updateScene({ grid: { color: '#ffffff', opacity: 0.35 } }));

const real = errors.filter((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
