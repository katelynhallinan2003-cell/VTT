// Torches and other light sources are not combatants: they stay out of the initiative tracker.
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
await dm.getByPlaceholder('New table name').fill('Z8');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);

const ids = await dm.evaluate(async () => {
  const c = window.__vtt.client;
  const hero = await c.addToken({ x: 245, y: 245, name: 'Aria', size: 1 });
  const goblin = await c.addToken({ x: 315, y: 245, name: 'Goblin', size: 1 });
  const torch = await c.addToken({ x: 385, y: 245, name: 'Torch', shape: 'none', light: { b: 20, d: 20, c: '#ffc27a' } });
  const carrier = await c.addToken({ x: 455, y: 245, name: 'Torch bearer', size: 1, light: { b: 20, d: 20, c: '#ffc27a' } });
  return { hero, goblin, torch, carrier };
});
await sleep(500);
await dm.keyboard.press('i');
await dm.locator('.initpop').waitFor();
await sleep(300);
const rollNames = await dm.locator('.initpop .roll-name').allInnerTexts();
check('the roll list has the creatures', rollNames.some((n) => /Aria/.test(n)) && rollNames.some((n) => /Goblin/.test(n)), JSON.stringify(rollNames));
check('a creature carrying a light is still in it', rollNames.some((n) => /Torch bearer/.test(n)));
check('but a light on its own is not', !rollNames.some((n) => /^\s*Torch\s*$/.test(n.split('\n')[0] ?? n)) && rollNames.length === 3, JSON.stringify(rollNames));
await dm.screenshot({ path: '/tmp/shots/z8-roll.png' });

// the client refuses it too
await dm.evaluate(async (i) => { await window.__vtt.client.initApply([{ tk: i.torch, n: 'Torch', i: 25 }, { tk: i.hero, n: 'Aria', i: 12 }]); }, ids);
await sleep(500);
const order = await dm.evaluate(() => window.__vtt.client.scene.init.entries.map((e) => e.n));
check('adding it by hand does nothing; the creature goes in', JSON.stringify(order) === JSON.stringify(['Aria']), JSON.stringify(order));

console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
