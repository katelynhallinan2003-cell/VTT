// Round 6h: save a whole campaign to a file and add it to another table.
import { launch, watch, sleep } from './lib.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
await dm.getByPlaceholder('New table name').fill('Lost Mine');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

// ---- fill the first table: a visible token, a hidden one with hit points, a wall, a drawing, a handout
const made = await dm.evaluate(async () => {
  const c = window.__vtt.client;
  const a = await c.addToken({ x: 175, y: 175, name: 'Goblin', hp: 7, maxHp: 7 });
  const h = await c.addToken({ x: 315, y: 175, name: 'Ghost', hidden: true, hp: 22, maxHp: 30 });
  await c.addWalls([{ a: { x: 700, y: 70 }, b: { x: 700, y: 400 }, k: 'wall', open: false, vis: true, one: 0, h: 0 }]);
  await c.addDrawing({ k: 'rect', p: '800,100,900,200', color: '#a8b0ba', w: 2, fill: 0.4, fc: '#a8b0ba', dash: false, txt: '', fs: 28, bw: 5, hz: 0 });
  await c.saveHandout({ title: 'A letter', text: 'Come alone.', img: null });
  return { a, h, name: c.sceneIndex[0].name };
});
await sleep(500);
const sceneName = made.name;
await dm.getByRole('button', { name: 'Settings' }).click();
await dm.locator('.modal .tabs button', { hasText: 'Pictures and files' }).click();
await dm.locator('.modal', { hasText: 'Campaign file' }).waitFor();

// ---- save it
const [dl] = await Promise.all([dm.waitForEvent('download'), dm.getByRole('button', { name: 'Save campaign to a file' }).click()]);
const file = '/tmp/x-campaign.json';
await dl.saveAs(file);
check('the file is named after the table', /Lost Mine/.test(dl.suggestedFilename()) && dl.suggestedFilename().endsWith('.json'), dl.suggestedFilename());
const data = JSON.parse(readFileSync(file, 'utf8'));
check('it says what it is', data.format === 'vtt-campaign' && data.version === 1 && data.table.name === 'Lost Mine');
check('it holds the scene, active', data.scenes.length === 1 && data.scenes[0].name === sceneName && data.scenes[0].active === true);
const sc = data.scenes[0];
check('with the public tokens', Object.keys(sc.pub.tokens ?? {}).length === 1 && Object.values(sc.pub.tokens)[0].name === 'Goblin');
check('and the hidden ones with their hit points, which only the DM has', Object.keys(sc.dm.tokens ?? {}).length === 1 && JSON.stringify(sc.dm.hp).includes('22'));
check('with the wall and the drawing', Object.keys(sc.pub.walls ?? {}).length === 1 && Object.keys(sc.pub.draw ?? {}).length === 1);
check('but not where people are pointing', !('live' in sc.pub) && !('pings' in sc.pub));
check('and the handout, without who it was shown to', data.handouts.length === 1 && data.handouts[0].title === 'A letter' && !('shown' in data.handouts[0]));
check('and the library', !!data.library && Array.isArray(data.library.maps));
await dm.screenshot({ path: '/tmp/shots/x1-settings.png' });
await dm.locator('.modal .btn', { hasText: 'Close' }).last().click().catch(() => dm.keyboard.press('Escape'));

// ---- a second table
await dm.goto(BASE);
await dm.getByPlaceholder('New table name').fill('Second');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
check('the new table has no scenes', (await dm.evaluate(() => window.__vtt.client.sceneIndex.length)) === 0);
await dm.getByRole('button', { name: 'Settings' }).click();
await dm.locator('.modal .tabs button', { hasText: 'Pictures and files' }).click();
await dm.locator('.modal', { hasText: 'Campaign file' }).waitFor();

// a file that is not one of ours
writeFileSync('/tmp/x-bad.json', '{"hello":1}');
await dm.locator('.modal input[type=file]').setInputFiles('/tmp/x-bad.json');
await dm.locator('.campaign-error').waitFor();
check('a wrong file is turned away with a reason', /not a campaign file/.test(await dm.locator('.campaign-error').innerText()));

await dm.locator('.modal input[type=file]').setInputFiles(file);
await dm.locator('.campaign-confirm').waitFor();
const conf = await dm.locator('.campaign-confirm').innerText();
check('it says what is in the file before adding anything', conf.includes('Lost Mine') && conf.includes(sceneName) && /1 handout/.test(conf), conf.replace(/\n/g, ' | ').slice(0, 120));
check('and nothing was added yet', (await dm.evaluate(() => window.__vtt.client.sceneIndex.length)) === 0);
await dm.screenshot({ path: '/tmp/shots/x2-confirm.png' });
await dm.getByRole('button', { name: 'Add to this table' }).click();
await dm.waitForFunction(() => window.__vtt.client.sceneIndex.length === 1, null, { timeout: 10000 });
check('the scene is there, under its own name', (await dm.evaluate(() => window.__vtt.client.sceneIndex[0].name)) === sceneName);
await dm.waitForFunction(() => window.__vtt.client.scene?.loaded && window.__vtt.client.scene.tokens.size >= 1, null, { timeout: 10000 });
const st = await dm.evaluate(() => {
  const c = window.__vtt.client;
  const toks = [...c.scene.tokens.values()];
  return {
    active: c.activeSceneId === c.sceneIndex[0].id,
    names: toks.map((t) => t.name).sort(),
    ghost: toks.find((t) => t.name === 'Ghost') ? { hp: toks.find((t) => t.name === 'Ghost').hp, hidden: toks.find((t) => t.name === 'Ghost').hidden } : null,
    walls: c.scene.walls?.size ?? 0,
    draws: c.scene.draws?.size ?? 0,
    handouts: [...c.handouts.values()].map((h) => ({ t: h.title, shown: h.shown })),
    mapUrl: c.scene.meta.mapUrl && c.scene.meta.mapUrl.length > 0,
  };
});
check('with the same tokens, hidden one included, hit points kept', st.names.join() === 'Ghost,Goblin' && st.ghost && st.ghost.hp === 22 && st.ghost.hidden === true, JSON.stringify(st.ghost));
check('and the wall and the drawing', st.walls === 1 && st.draws === 1, `walls ${st.walls} draws ${st.draws}`);
check('and the map picture', !!st.mapUrl);
check('it became the scene players are on, since there was none', st.active);
check('the handout came in, not shown', st.handouts.length === 1 && st.handouts[0].t === 'A letter' && st.handouts[0].shown === false);

// ---- again: nothing is replaced
await dm.locator('.modal input[type=file]').setInputFiles(file);
await dm.locator('.campaign-confirm').waitFor();
await dm.getByRole('button', { name: 'Add to this table' }).click();
await dm.waitForFunction(() => window.__vtt.client.sceneIndex.length === 2, null, { timeout: 10000 });
const second = await dm.evaluate(() => { const c = window.__vtt.client; return { names: c.sceneIndex.map((s) => s.name), active: c.activeSceneId === c.sceneIndex[0].id, orders: c.sceneIndex.map((s) => s.order), handouts: c.handouts.size }; });
check('adding it again makes a second scene, told apart by name', second.names[0] === sceneName && second.names[1] === `${sceneName} (2)`, second.names.join(' / '));
check('without moving the players off the scene they were on', second.active);
check('and two handouts now', second.handouts === 2);
check('in order', second.orders[0] < second.orders[1]);

// ---- a player at the second table sees only what players should
await dm.keyboard.press('Escape');
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const pl = await context.newPage();
watch(pl, 'Aria', errors);
await pl.goto(`${BASE}#/t/${tid}`);
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button', { name: 'Join table' }).click();
await pl.waitForSelector('.board-host canvas');
await pl.waitForFunction(() => window.__vtt.client.scene?.loaded && window.__vtt.client.scene.tokens.size >= 1, null, { timeout: 10000 });
await sleep(500);
const pv = await pl.evaluate(() => { const c = window.__vtt.client; return { names: [...c.scene.tokens.values()].map((t) => t.name), handouts: c.handouts.size }; });
check('a player sees the goblin, not the ghost, and no handouts yet', pv.names.join() === 'Goblin' && pv.handouts === 0, JSON.stringify(pv));
const noButton = await pl.locator('header.pill-right button', { hasText: /^Handouts/ }).count();
check('and has no Handouts button', noButton === 0);

console.log(errors.length ? errors.join('\n') : 'no console problems');
await browser.close();
const bad = results.filter((r) => !r).length;
console.log(`${results.length - bad}/${results.length} checks passed`);
// the demo's sample dungeon is a temporary picture that cannot survive a page reload; real maps are hosted links
process.exit(errors.some((e) => !/GPU stall|ReadPixels|willReadFrequently|ERR_FILE_NOT_FOUND|texture load failed blob:|Could not load image|i\.onerror/.test(e)) || bad ? 1 : 0);
