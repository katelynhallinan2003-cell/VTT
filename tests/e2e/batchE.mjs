// Drawing: shapes you can select, restyle and resize; text you can edit; ruler colour.
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
await dm.getByPlaceholder('New table name').fill('E');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await dm.locator('.rail-tab', { hasText: 'Scene' }).click(); // fold the panel away
await sleep(400);

const draws = () => dm.evaluate(() => [...window.__vtt.client.scene.draws.values()].sort((a, b) => (a.id < b.id ? -1 : 1)));
const sel = () => dm.evaluate(() => [...window.__vtt.ui.data.drawSel]);
const toScreen = (x, y) => dm.evaluate(([x, y]) => window.__vtt.board.worldToScreen({ x, y }), [x, y]);
const cell = await dm.evaluate(() => window.__vtt.client.grid.cell);

// ---- draw a box
await dm.keyboard.press('p');
await dm.locator('.flyout .seg button', { hasText: 'Box' }).click();
check('draw flyout offers None / See-through / Solid', (await dm.locator('.flyout .seg button').allTextContents()).join('|').includes('None|See-through|Solid'));
const a = await toScreen(11 * cell, 3 * cell);
const b = await toScreen(14 * cell, 5 * cell);
await dm.mouse.move(a.x, a.y); await dm.mouse.down(); await dm.mouse.move(b.x, b.y, { steps: 6 }); await dm.mouse.up();
await sleep(300);
let list = await draws();
check('a box was drawn', list.length === 1 && list[0].k === 'rect');
check('the new box is selected with the draw tool still on', (await sel()).length === 1 && (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'draw');
check('the inspector shows up for it', (await dm.locator('.drawtag .dt-head strong').innerText()) === 'Box');
await dm.screenshot({ path: '/tmp/shots/70-box-inspector.png' });

// ---- fill + colours
await dm.locator('.drawtag .seg button', { hasText: 'Solid' }).click(); await sleep(200);
check('Solid fill', (await draws())[0].fill === 1);
await dm.locator('.drawtag .seg button', { hasText: 'See-through' }).click(); await sleep(200);
check('See-through fill', (await draws())[0].fill === 0.3);
await dm.locator('.drawtag .swatches').nth(1).locator('input[type=color]').fill('#00aa44'); await sleep(200);
check('fill colour is separate from the outline colour', (await draws())[0].fc.toLowerCase() === '#00aa44' && (await draws())[0].color.toLowerCase() !== '#00aa44');
await dm.locator('.drawtag .swatches').nth(0).locator('.swatch').nth(4).click(); await sleep(200);
check('outline colour changes on its own', (await draws())[0].color.toLowerCase() === '#1c7ed6' && (await draws())[0].fc.toLowerCase() === '#00aa44', (await draws())[0].color);
await dm.screenshot({ path: '/tmp/shots/71-box-filled.png' });

// ---- numbers
await dm.locator('.numf', { hasText: 'Width' }).locator('input').fill('30');
await dm.locator('.numf', { hasText: 'Width' }).locator('input').press('Enter'); await sleep(250);
const sz = await dm.evaluate(() => { const d = [...window.__vtt.client.scene.draws.values()][0]; const p = d.p.split(',').map(Number); return { w: Math.abs(p[2] - p[0]) / window.__vtt.client.grid.cell * window.__vtt.client.grid.ft, h: Math.abs(p[3] - p[1]) / window.__vtt.client.grid.cell * window.__vtt.client.grid.ft }; });
check('typing a width resizes the box', Math.abs(sz.w - 30) < 0.2, JSON.stringify(sz));

// ---- drag a handle (the south-east corner), still with the draw tool
const before = (await draws())[0].p;
const se = await dm.evaluate(() => { const d = [...window.__vtt.client.scene.draws.values()][0]; const p = d.p.split(',').map(Number); return window.__vtt.board.worldToScreen({ x: Math.max(p[0], p[2]), y: Math.max(p[1], p[3]) }); });
await dm.mouse.move(se.x, se.y); await dm.mouse.down(); await dm.mouse.move(se.x + 40, se.y + 30, { steps: 5 });
const mid = await dm.evaluate(() => window.__vtt.board.drawPreview?.patch?.p ?? null);
await dm.mouse.up(); await sleep(300);
const after = (await draws())[0].p;
check('dragging the corner dot resizes it (with a live preview)', after !== before && mid !== null, `${before} -> ${after}`);
check('resizing did not draw a second shape', (await draws()).length === 1);

// ---- move with the select tool, then delete with the Delete key, then undo
await dm.keyboard.press('v');
const pb = (await draws())[0].p.split(',').map(Number);
const edge = await toScreen(pb[0] + 60, pb[1]);
await dm.mouse.move(edge.x, edge.y); await dm.mouse.down(); await dm.mouse.move(edge.x + 50, edge.y + 40, { steps: 5 }); await dm.mouse.up(); await sleep(300);
const pm = (await draws())[0].p.split(',').map(Number);
check('the select tool drags the box', Math.abs(pm[0] - pb[0]) > 10 && Math.abs(pm[1] - pb[1]) > 10, `${pb[0]}->${pm[0]}`);
await dm.keyboard.press('Delete'); await sleep(250);
check('Delete removes the selected shape', (await draws()).length === 0);
await dm.keyboard.press('Control+z'); await sleep(250);
check('Ctrl+Z brings it back', (await draws()).length === 1);

// ---- a see-through box can be grabbed by clicking inside it once selected
await dm.keyboard.press('Escape');
const inside = await dm.evaluate(() => { const d = [...window.__vtt.client.scene.draws.values()][0]; const p = d.p.split(',').map(Number); return window.__vtt.board.worldToScreen({ x: (p[0] + p[2]) / 2, y: (p[1] + p[3]) / 2 }); });
await dm.mouse.click(inside.x, inside.y); await sleep(200);
check('clicking inside a see-through box does not select it', (await sel()).length === 0);
await dm.evaluate(() => window.__vtt.ui.selectDrawings([[...window.__vtt.client.scene.draws.keys()][0]]));
const p0 = (await draws())[0].p.split(',').map(Number);
await dm.mouse.move(inside.x, inside.y); await dm.mouse.down(); await dm.mouse.move(inside.x + 30, inside.y, { steps: 4 }); await dm.mouse.up(); await sleep(300);
const p1 = (await draws())[0].p.split(',').map(Number);
check('but once selected, dragging from inside moves it', p1[0] - p0[0] > 10, `${p0[0]} -> ${p1[0]}`);
await dm.keyboard.press('Delete'); await sleep(200);

// ---- text: type in place, then edit it again
await dm.keyboard.press('p');
await dm.locator('.flyout .seg button', { hasText: 'Text' }).click();
const t0 = await toScreen(12 * cell, 8 * cell);
await dm.mouse.click(t0.x, t0.y); await sleep(250);
check('a text box opens where you clicked', (await dm.locator('.text-editor').count()) === 1);
const bx = await dm.locator('.text-editor').boundingBox();
check('and it is small (not a page-wide box)', bx.width < 200 && bx.height < 120, `${Math.round(bx.width)}x${Math.round(bx.height)}`);
await dm.keyboard.type('Hello'); await dm.keyboard.press('Enter'); await sleep(300);
list = await draws();
check('Enter saves the text', list.length === 1 && list[0].k === 'text' && list[0].txt === 'Hello');
check('the new text is selected and the inspector says Text', (await dm.locator('.drawtag .dt-head strong').innerText()) === 'Text');
await dm.screenshot({ path: '/tmp/shots/72-text-inspector.png' });

// the editor scales with zoom
const fs = list[0].fs;
await dm.keyboard.press('v');
const tc = await dm.evaluate(() => { const d = [...window.__vtt.client.scene.draws.values()][0]; const p = d.p.split(',').map(Number); return { x: p[0] + 10, y: p[1] + 10 }; });
const ts = await toScreen(tc.x, tc.y);
await dm.mouse.dblclick(ts.x, ts.y); await sleep(300);
check('double-clicking text opens it for editing', (await dm.locator('.text-editor').count()) === 1 && (await dm.locator('.text-editor').inputValue()) === 'Hello');
const z1 = await dm.evaluate(() => window.__vtt.board.zoomNow);
const f1 = await dm.locator('.text-editor').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check('editor text is the same size as the real text at this zoom', Math.abs(f1 - fs * z1) < 1.5, `${f1.toFixed(1)} vs ${(fs * z1).toFixed(1)}`);
await dm.keyboard.type(' world'); await dm.keyboard.press('Enter'); await sleep(300);
check('edited text is saved', (await draws())[0].txt === 'Hello world');
// zoom in and open again
await dm.mouse.move(700, 450);
for (let i = 0; i < 4; i++) { await dm.mouse.wheel(0, -300); await sleep(60); }
await sleep(300);
const ts2 = await dm.evaluate(() => { const d = [...window.__vtt.client.scene.draws.values()][0]; const p = d.p.split(',').map(Number); return window.__vtt.board.worldToScreen({ x: p[0] + 10, y: p[1] + 10 }); });
await dm.keyboard.press('Enter'); await sleep(300);
const z2 = await dm.evaluate(() => window.__vtt.board.zoomNow);
const f2 = await dm.locator('.text-editor').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
check('Enter on selected text opens it; the box follows the zoom', z2 > z1 * 1.3 && Math.abs(f2 - fs * z2) < 2, `zoom ${z1.toFixed(2)} -> ${z2.toFixed(2)}, font ${f2.toFixed(1)}`);
await dm.keyboard.press('Escape'); await sleep(200);
check('Escape closes the box without changing the text', (await dm.locator('.text-editor').count()) === 0 && (await draws())[0].txt === 'Hello world');
await dm.keyboard.press('Home').catch(() => {});
await dm.evaluate(() => window.__vtt.board.fit()); await sleep(300);

// ---- text styling
await dm.evaluate(() => window.__vtt.ui.selectDrawings([[...window.__vtt.client.scene.draws.keys()][0]]));
await sleep(150);
await dm.locator('.drawtag select').selectOption('serif'); await sleep(150);
await dm.locator('.drawtag button[aria-label="Italic"]').click(); await sleep(150);
await dm.locator('.drawtag button[aria-label="Underline"]').click(); await sleep(150);
await dm.locator('.drawtag button[aria-label="Bold"]').click(); await sleep(150);
let t = (await draws())[0];
check('font, italic, underline and bold are saved on the text', t.font === 'serif' && t.i === true && t.u === true && t.b === false, JSON.stringify({ f: t.font, i: t.i, u: t.u, b: t.b }));
await dm.locator('.drawtag .numf', { hasText: 'Size' }).locator('input').fill('100');
await dm.locator('.drawtag .numf', { hasText: 'Size' }).locator('input').press('Enter'); await sleep(250);
t = (await draws())[0];
check('the size box sets the letter height (100% = one square)', Math.abs(t.fs - cell) < 1.5, `${t.fs} vs ${cell}`);
await dm.locator('.drawtag .swatches .swatch').nth(5).click(); await sleep(150);
check('text colour changes', (await draws())[0].color.toLowerCase() === '#7048e8');
await dm.screenshot({ path: '/tmp/shots/73-text-styled.png' });
// drag its corner to make it bigger
await dm.keyboard.press('v');
const hpos = await dm.evaluate(() => {
  const b = window.__vtt.board; const id = [...window.__vtt.ui.data.drawSel][0];
  const d = window.__vtt.client.scene.draws.get(id);
  const bounds = b.drawLayer.boundsOf(d, window.__vtt.client.grid);
  return b.worldToScreen({ x: bounds.x + bounds.w, y: bounds.y + bounds.h });
});
const fsBefore = (await draws())[0].fs;
await dm.mouse.move(hpos.x, hpos.y); await dm.mouse.down(); await dm.mouse.move(hpos.x + 60, hpos.y + 40, { steps: 5 }); await dm.mouse.up(); await sleep(300);
check('dragging the text corner scales the text', (await draws())[0].fs > fsBefore * 1.15, `${fsBefore} -> ${(await draws())[0].fs}`);
await dm.keyboard.press('Delete'); await sleep(200);
check('Delete removes the text too', (await draws()).length === 0);

// ---- a line has two end handles and a length in feet
await dm.keyboard.press('p');
await dm.locator('.flyout .seg button', { hasText: 'Arrow' }).click();
const l0 = await toScreen(10 * cell, 10 * cell), l1 = await toScreen(14 * cell, 10 * cell);
await dm.mouse.move(l0.x, l0.y); await dm.mouse.down(); await dm.mouse.move(l1.x, l1.y, { steps: 5 }); await dm.mouse.up(); await sleep(300);
check('an arrow shows a Length box', (await dm.locator('.drawtag .numf', { hasText: 'Length' }).count()) === 1);
await dm.locator('.drawtag .numf', { hasText: 'Length' }).locator('input').fill('40');
await dm.locator('.drawtag .numf', { hasText: 'Length' }).locator('input').press('Enter'); await sleep(250);
const ap = (await draws())[0].p.split(',').map(Number);
check('arrow length follows the number', Math.abs(Math.hypot(ap[2] - ap[0], ap[3] - ap[1]) / cell * 5 - 40) < 0.3);
await dm.keyboard.press('Delete'); await sleep(200);

// ---- ruler colour, and test move switches the ruler off
await dm.keyboard.press('r');
check('ruler panel has a colour choice', (await dm.locator('.flyout .swatches').count()) === 1);
check('ruler panel no longer talks about grid rules', !(await dm.locator('.flyout').innerText()).toLowerCase().includes('grid rule'));
await dm.locator('.flyout .swatches .swatch').nth(4).click(); await sleep(100);
check('ruler colour is stored', (await dm.evaluate(() => window.__vtt.ui.data.rulerColor)) === '#2f9e44', await dm.evaluate(() => window.__vtt.ui.data.rulerColor));
const r0 = await toScreen(9 * cell, 3 * cell), r1 = await toScreen(14 * cell, 3 * cell);
await dm.mouse.move(r0.x, r0.y); await dm.mouse.down(); await dm.mouse.move(r1.x, r1.y, { steps: 4 });
await dm.screenshot({ path: '/tmp/shots/74-ruler-colour.png' });
await dm.mouse.up();
await dm.keyboard.press('m'); await sleep(200);
check('turning on test move switches the ruler off', (await dm.evaluate(() => window.__vtt.ui.data.tool)) === 'select' && (await dm.evaluate(() => window.__vtt.ui.data.testMove)) === true);
await dm.keyboard.press('m');

console.log(errors.filter((e) => !/GPU stall|ReadPixels/.test(e)).join('\n') || 'no console errors');
await browser.close();
process.exit(results.every(Boolean) && !errors.some((e) => /pageerror/.test(e)) ? 0 : 1);
