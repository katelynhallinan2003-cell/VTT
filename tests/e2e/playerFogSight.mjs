// Round 7k: torches are not in the Tokens list (they have a folded Lights list) and a player cannot take one.
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
await dm.getByPlaceholder('New table name').fill('Fog and sight');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(500);
const tid = await dm.evaluate(() => location.hash.replace('#/t/', ''));
const player = await context.newPage();
watch(player, 'player', errors);
await player.goto(`${BASE}#/t/${tid}`);
await player.getByPlaceholder('e.g. Aria').fill('Aria');
await player.getByRole('button', {name:'Join table'}).click();
await player.waitForFunction(() => window.__vtt?.board?.mapSprite);
const uid = await player.evaluate(() => window.__vtt.client.uid);
const tokenId = await dm.evaluate(ownerUid => {
  const {client} = window.__vtt, g = client.grid;
  return client.addToken({name:'Scout', x:g.ox+11.5*g.cell,y:g.oy+8.5*g.cell,ownerUid,sight:20,dv:10});
}, uid);
await player.keyboard.press('Escape');
await player.waitForFunction(id => window.__vtt.board.views.has(id),tokenId);
await player.evaluate(() => window.__vtt.board.fit());
const points = await player.evaluate(id => {
  const {client,board} = window.__vtt, t = client.scene.tokens.get(id);
  return [1.5,7].map(n => board.worldToScreen({x:t.x+n*client.grid.cell,y:t.y}));
},tokenId);
// Read the pixels the player actually sees, including the final fog and lighting masks.
async function samples(at = points) {
  const png = await player.screenshot();
  return player.evaluate(async ({points,data}) => {
    const img = new Image();
    img.src = 'data:image/png;base64,'+data;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d',{willReadFrequently:true});
    ctx.drawImage(img,0,0);
    return points.map(p => {
      const pixels = ctx.getImageData(Math.round(p.x)-3,Math.round(p.y)-3,7,7).data;
      let sum = 0;
      for (let i=0;i<pixels.length;i+=4) sum += pixels[i]+pixels[i+1]+pixels[i+2];
      return Math.round(sum/147);
    });
  },{points:at,data:png.toString('base64')});
}
const before = await samples();
await dm.locator('.dock button',{hasText:'Hide everything'}).click();
await player.waitForFunction(() => window.__vtt.client.scene.meta.fog.enabled);
await sleep(250);
const bright = await samples();
check('Hide everything preserves visible artwork inside sight and covers distant ground',
  bright[0] > 25 && Math.abs(bright[0]-before[0]) < 8 && bright[1] < before[1]-15, JSON.stringify({before,bright}));
await dm.evaluate(() => window.__vtt.client.updateScene({light:{ambient:'dark'}},{record:false}));
await player.waitForFunction(() => window.__vtt.client.scene.meta.light.ambient === 'dark');
await sleep(300);
const dark = await samples();
check('in darkness the player sees nearby ground through darkvision while distant ground stays covered',
  dark[0] > dark[1]+10 && dark[0] < bright[0], JSON.stringify(dark));
await dm.evaluate(() => window.__vtt.client.updateScene({light:{ambient:'bright'}},{record:false}));
await player.waitForFunction(() => window.__vtt.client.scene.meta.light.ambient === 'bright');
const wall = await dm.evaluate(async id => {
  const {client} = window.__vtt, t = client.scene.tokens.get(id), cell = client.grid.cell;
  const x = t.x + cell;
  return (await client.addWalls([{k:'wall',a:{x,y:t.y-2*cell},b:{x,y:t.y+2*cell},h:0}]))[0];
},tokenId);
await player.waitForFunction(id => window.__vtt.client.scene.walls.has(id),wall);
await sleep(250);
const blocked = await samples();
check('a closed wall still hides ground inside the token’s nominal sight distance',blocked[0] < bright[0]-15,JSON.stringify(blocked));
await dm.evaluate(() => window.__vtt.client.history.undo()); // wall
await player.waitForFunction(id => !window.__vtt.client.scene.walls.has(id),wall);
async function placeWall(halfWidth, height) {
  const id = await dm.evaluate(async ([id, width, h]) => {
    const {client} = window.__vtt, t = client.scene.tokens.get(id), cell = client.grid.cell, x = t.x + cell;
    return (await client.addWalls([{k:'wall', a:{x,y:t.y-width*cell}, b:{x,y:t.y+width*cell}, h}]))[0];
  }, [tokenId, halfWidth, height]);
  await player.waitForFunction(id => window.__vtt.client.scene.walls.has(id),id);
  await sleep(200);
  return id;
}
async function undoWall(id) {
  await dm.evaluate(() => window.__vtt.client.history.undo());
  await player.waitForFunction(id => !window.__vtt.client.scene.walls.has(id),id);
}
const sliver = await placeWall(0.06, 0);
check('a narrow blocker casts no black band across the player map', (await samples())[0] > bright[0]-10);
await undoWall(sliver);
const parapet = await placeWall(1.5,10);
check('a Medium scout is below a 10 ft wall', (await samples())[0] < bright[0]-15);
await dm.evaluate(id => window.__vtt.client.updateTokens([id],{size:2}),tokenId);
await player.waitForFunction(id => window.__vtt.client.scene.tokens.get(id).size === 2,tokenId);
await sleep(200);
check('resizing the scout to Large immediately clears that same wall', (await samples())[0] > bright[0]-10);
await dm.evaluate(() => window.__vtt.client.history.undo());
await undoWall(parapet);
const hill = await dm.evaluate(id => {
  const {client} = window.__vtt, t = client.scene.tokens.get(id), c = client.grid.cell;
  return client.addDrawing({k:'rect',p:[t.x+c,t.y-3*c,t.x+4*c,t.y+3*c].join(','),hz:15,w:1,color:'#ffffff',fill:0});
},tokenId);
await player.waitForFunction(id => window.__vtt.client.scene.draws.has(id),hill);
await sleep(200);
check('a player below a hill sees onto its near side', (await samples())[0] > bright[0]-10);
const summit = await dm.evaluate(id => {
  const {client} = window.__vtt, t = client.scene.tokens.get(id), c = client.grid.cell;
  return client.addDrawing({k:'rect',p:[t.x+3.5*c,t.y-2*c,t.x+4*c,t.y+2*c].join(','),hz:42,w:1,color:'#ffffff',fill:0});
},tokenId);
await player.waitForFunction(id => window.__vtt.client.scene.draws.has(id),summit);
const hillSpots = await player.evaluate(id => {
  const {client,board} = window.__vtt, t = client.scene.tokens.get(id);
  return [2.6,3.6].map(n => board.worldToScreen({x:t.x+n*client.grid.cell, y:t.y}));
},tokenId);
await sleep(200);
const [shelf, face] = await samples(hillSpots);
check('the player sees the taller face beyond the hidden shelf', face > shelf+15, JSON.stringify({shelf,face}));
await dm.evaluate(() => window.__vtt.client.history.undo());
await player.waitForFunction(id => !window.__vtt.client.scene.draws.has(id),summit);
await dm.evaluate(id => window.__vtt.client.updateDrawings([id],{hz:65}),hill);
await player.waitForFunction(id => window.__vtt.client.scene.draws.get(id).hz === 65,hill);
await sleep(200);
check('raising the same hill reduces the visible depth', (await samples())[0] < bright[0]-15);
await dm.evaluate(() => window.__vtt.client.history.undo());
await dm.evaluate(() => window.__vtt.client.history.undo());
await dm.evaluate(() => window.__vtt.client.history.undo()); // hide everything
await player.waitForFunction(() => !window.__vtt.client.scene.meta.fog.enabled);
check('undo restores the prior token sight setting', !(await player.evaluate(() => window.__vtt.client.scene.meta.fog.vision)));
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.includes(false) || errors.some(e => e.includes('pageerror')) ? 1 : 0);
