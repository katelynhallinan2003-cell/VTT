// Round 6g: handouts. The DM makes them and shows them to everyone or some players; players see only what is shown to them.
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
await dm.getByPlaceholder('New table name').fill('W');
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
  // a player may be offered an unclaimed token first; that window would (rightly) keep a handout from opening over it
  if (await pl.locator('.modal').count()) { console.log('note: ' + name + ' had a window open: ' + (await pl.locator('.modal').first().innerText()).slice(0, 60).replace(/\n/g, ' ')); await pl.keyboard.press('Escape'); await sleep(200); }
  return pl;
};
const aria = await join('Aria');
const bram = await join('Bram');
await dm.bringToFront();
const handoutsBtn = (p) => p.locator('header.pill-right button', { hasText: /^Handouts/ });

check('the DM has a Handouts button', (await handoutsBtn(dm).count()) === 1);
check('players have none while nothing is shown to them', (await handoutsBtn(aria).count()) === 0 && (await handoutsBtn(bram).count()) === 0);

// ---- make one
await handoutsBtn(dm).click();
await dm.locator('.modal', { hasText: 'Nothing yet' }).waitFor();
await dm.getByRole('button', { name: '+ New handout' }).click();
const save = dm.locator('.modal .btn.primary', { hasText: 'Save' });
check('an empty one cannot be saved', await save.isDisabled());
await dm.getByPlaceholder('A letter from the baron').fill('A letter from the baron');
await dm.getByPlaceholder('What the players read').fill('Meet me at the old mill.\nCome alone.');
await save.click();
await dm.locator('.handout-row').waitFor();
check('it is in the list, not shown yet', (await dm.locator('.handout-row .handout-title').innerText()) === 'A letter from the baron' && (await dm.locator('.handout-state').innerText()) === 'Not shown');
check('players still see nothing', (await handoutsBtn(aria).count()) === 0);

// ---- a picture on a second one
await dm.getByRole('button', { name: '+ New handout' }).click();
await dm.getByPlaceholder('A letter from the baron').fill('Torn map');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFAAEPBAEZUxNnAAAAAElFTkSuQmCC', 'base64');
await dm.locator('.modal input[type=file]').setInputFiles({ name: 'map.png', mimeType: 'image/png', buffer: png });
await dm.locator('.modal img.handout-img').waitFor({ timeout: 15000 });
await dm.locator('.modal .btn.primary', { hasText: 'Save' }).click();
await dm.locator('.handout-row').nth(1).waitFor();
check('a handout can carry a picture', (await dm.locator('.handout-row img.handout-thumb').count()) === 1);

// ---- show the first to everyone
await dm.locator('.handout-row').first().getByRole('button', { name: 'Show…' }).click();
await dm.locator('.modal .seg button', { hasText: 'Everyone' }).waitFor();
await dm.getByRole('button', { name: 'Show it' }).click();
await dm.locator('.handout-state.on').first().waitFor();
check('the list says it is shown to everyone', (await dm.locator('.handout-state').first().innerText()) === 'Shown to everyone');
await aria.bringToFront();
await aria.locator('.modal', { hasText: 'Meet me at the old mill.' }).waitFor({ timeout: 8000 });
check('it opens on a player\'s screen by itself, with the words', (await aria.locator('.handout-text').innerText()).includes('Come alone.'));
check('and the player is told', (await aria.locator('.toast', { hasText: /shared a handout/i }).count()) >= 1);
await aria.screenshot({ path: '/tmp/shots/w1-player.png' });
await bram.bringToFront();
await bram.locator('.modal', { hasText: 'Meet me at the old mill.' }).waitFor({ timeout: 8000 });
check('and on every other player\'s', true);
await bram.locator('.modal .btn', { hasText: 'Close' }).last().click();
check('a player gets a Handouts button with a count', (await handoutsBtn(bram).innerText()).includes('(1)'));
await handoutsBtn(bram).click();
check('the list holds only what was shown (not the other one)', (await bram.locator('.handout-row').count()) === 1);
await bram.locator('.handout-row-main').click();
check('clicking it reads it', (await bram.locator('.handout-text').count()) === 1);
await bram.keyboard.press('Escape');

// ---- the second one, to Aria only
await dm.bringToFront();
await dm.locator('.handout-row').nth(1).getByRole('button', { name: 'Show…' }).click();
await dm.locator('.modal .seg button', { hasText: 'Some players' }).click();
await dm.locator('.modal label.toggle', { hasText: 'Bram' }).locator('input').uncheck().catch(() => {});
await dm.locator('.modal label.toggle', { hasText: 'Aria' }).locator('input').check();
await dm.getByRole('button', { name: 'Show it' }).click();
await dm.locator('.handout-row').nth(1).locator('.handout-state.on').waitFor();
check('the list names who it is shown to', /Aria/.test(await dm.locator('.handout-row').nth(1).locator('.handout-state').innerText()) && !/Bram/.test(await dm.locator('.handout-row').nth(1).locator('.handout-state').innerText()));
await aria.bringToFront();
await aria.locator('.modal img.handout-img').waitFor({ timeout: 8000 });
check('Aria gets it with its picture', (await aria.locator('.modal img.handout-img').count()) === 1);
await aria.keyboard.press('Escape');
check('Aria now has two handouts', (await handoutsBtn(aria).innerText()).includes('(2)'));
await bram.bringToFront();
await sleep(500);
check('Bram still has one, and no pop-up opened', (await handoutsBtn(bram).innerText()).includes('(1)') && (await bram.locator('.modal').count()) === 0);

// ---- changing one that is shown changes it for the players, quietly
await dm.bringToFront();
await dm.locator('.handout-row').first().getByRole('button', { name: 'Edit' }).click();
await dm.getByPlaceholder('What the players read').fill('Meet me at the new mill.');
await dm.locator('.modal .btn.primary', { hasText: 'Save' }).click();
await dm.locator('.handout-row').first().waitFor();
await bram.bringToFront();
await sleep(800);
check('the change reaches the player without opening a window', (await bram.locator('.modal').count()) === 0);
await handoutsBtn(bram).click();
await bram.locator('.handout-row-main').click();
check('and reads the new words', (await bram.locator('.handout-text').innerText()) === 'Meet me at the new mill.');
await bram.keyboard.press('Escape');

// ---- take one back
await dm.bringToFront();
await dm.locator('.handout-row').first().getByRole('button', { name: 'Hide' }).click();
await dm.locator('.handout-row').first().locator('.handout-state').filter({ hasText: 'Not shown' }).waitFor();
await bram.bringToFront();
await sleep(800);
check('hiding it takes it away from the player', (await handoutsBtn(bram).count()) === 0);
check('the DM still has it', (await dm.locator('.handout-row').count()) === 2);

// ---- show it again: it opens again
await dm.bringToFront();
await dm.locator('.handout-row').first().getByRole('button', { name: 'Show…' }).click();
await dm.getByRole('button', { name: 'Show it' }).click();
await bram.bringToFront();
await bram.locator('.modal', { hasText: 'Meet me at the new mill.' }).waitFor({ timeout: 8000 });
check('showing it again opens it again', true);
await bram.keyboard.press('Escape');

// ---- delete
await dm.bringToFront();
await dm.locator('.handout-row').nth(1).getByRole('button', { name: 'Delete' }).click();
check('delete asks first', (await dm.locator('.handout-row').count()) === 2);
await dm.getByRole('button', { name: 'Sure?' }).click();
await sleep(500);
check('and then it is gone', (await dm.locator('.handout-row').count()) === 1);
await aria.bringToFront();
await sleep(600);
check('gone for the player too', (await handoutsBtn(aria).innerText()).includes('(1)'));

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently/.test(e)) || bad ? 1 : 0);
