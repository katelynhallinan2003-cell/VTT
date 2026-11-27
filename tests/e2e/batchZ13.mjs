// Guided height mapping, protection of existing paint, and one-step undo.
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
await dm.getByPlaceholder('New table name').fill('Z13');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(600);



// stony floor with two blue pools, aligned to a 100 px grid
const b64 = await dm.evaluate(async () => {
  const W = 1400, H = 1000;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#c9c4b8'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#2a5cc8';
  x.fillRect(200, 200, 300, 200);   // 3 x 2 squares
  x.fillRect(900, 500, 200, 300);   // 2 x 3 squares
  x.fillStyle = '#2e9a4f';
  x.fillRect(1200, 100, 100, 100);  // one green square
  return c.toDataURL('image/png').split(',')[1];
});
await dm.locator('.sect input[type=file]').first().setInputFiles({ name: 'pools.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') });
await dm.waitForFunction(() => { const b = window.__vtt.board; return b.mapTex && b.mapTex.w === 1400 && !window.__vtt.client.scene.meta.mapUrl.includes('sample'); }, null, { timeout: 20000 });
await sleep(800);
await dm.evaluate(() => { const m = window.__vtt.client.scene.meta; return window.__vtt.client.updateScene({ mapX: 0, mapY: 0, mapScale: 1, grid: { ...m.grid, shape: 'square', cell: 100, ox: 0, oy: 0, snap: true } }); });
await sleep(500);
const areas = () => dm.evaluate(() => { const c = window.__vtt.client; return [...c.scene.draws.values()].filter((d) => d.k === 'terrain'); });

// A hand-painted zero-height island inside the pool must survive.
await dm.evaluate(() => window.__vtt.client.addDrawings([{k:'terrain', hg:'old', hz:0, hr:'4', p:'275,240,315,240,315,280,275,280', color:'#aaaaaa', w:1, fill:0, dash:false, txt:'', fs:28, bw:5}]));
await dm.keyboard.press('h');
await dm.locator('.terrain-menu summary').click();
const open = async () => {
  await dm.getByRole('button', {name:'Auto height map',exact:true}).click();
  await dm.locator('svg.auto-height-map image').waitFor();
};
await open();
const clickMap = async (x,y) => {
  const point = await dm.locator('svg.auto-height-map').evaluate((svg,[x,y]) => {
    const p = new DOMPoint(x,y).matrixTransform(svg.getScreenCTM()); return [p.x,p.y];
  },[x,y]);
  await dm.mouse.click(...point);
};
check('Apply waits for a mark',await dm.getByRole('button',{name:'Apply heights'}).isDisabled());
await dm.getByRole('button',{name:'Zoom in'}).click();
await clickMap(450,300);
await dm.getByRole('button',{name:'Fit map',exact:true}).click();
check('zoom preserves the mark', await dm.locator('[data-mark]').count()===1);
await dm.getByRole('button',{name:'Cancel',exact:true}).click();
check('Cancel preserves the original terrain', (await areas()).length===1);
await open();
await dm.getByLabel('Height in feet').fill('-10');
await clickMap(350,300);
await clickMap(1000,650);
await dm.getByRole('button',{name:'Undo mark'}).click();
check('undoing a mark removes just that mark',await dm.locator('[data-mark]').count()===1);
await clickMap(1000,650);
await dm.getByLabel('Height in feet').fill('5');
await clickMap(1250,150);
await dm.getByLabel('Height in feet').fill('0');
await clickMap(700,700);
await dm.getByRole('button',{name:'Apply heights'}).click();
await dm.getByRole('dialog',{name:'Auto height map'}).waitFor({state:'hidden'});
await dm.waitForFunction(()=>window.__vtt.client.scene.draws.size>=5);
const t=await areas();
check('the full map includes an editable 0 ft floor', t.length===5 && t.some(d=>d.hg!=='old' && d.hz===0) && t.every(d=>d.hr));
await dm.waitForFunction(()=>window.__vtt.board.seenZoneRev===window.__vtt.client.scene.drawRev);
const g=await dm.evaluate(() => {
  const b=window.__vtt.board,t={fly:false,size:1,x:0,y:0};
  return [[350,300],[1000,650],[700,700],[1250,150],[295,260]].map(([x,y])=>b.heightOf(t,{x,y}).ground);
});
check('pools, floor, platform and existing zero-height island have the intended heights',JSON.stringify(g)==='[-10,-10,0,5,0]',JSON.stringify(g));
await dm.keyboard.press('Control+z');
await dm.waitForFunction(()=>window.__vtt.client.scene.draws.size===1);
check('one undo restores the hand-painted scene',(await areas())[0].hg==='old');
await open();
await dm.getByLabel('Height in feet').fill('10');
await clickMap(350,300);
const outlines=()=>dm.locator('svg.auto-height-map > g > path[fill-rule]').evaluateAll(nodes=>nodes.map(p=>p.getAttribute('d')));
const before=await outlines();
await dm.getByRole('button',{name:'Edit regions'}).click();
await clickMap(350,300);
await dm.getByRole('checkbox',{name:/Gradient/}).check();
const edge=dm.locator('g[data-contact]').first();
const spot=await edge.locator('path').first().evaluate(p=>{
  const at=p.getPointAtLength(p.getTotalLength()/2);
  const screen=at.matrixTransform(p.getScreenCTM());
  return [screen.x,screen.y,at.x,at.y];
});
await dm.mouse.click(spot[0],spot[1]);
check('clicking a wall makes that contact smooth',await edge.getAttribute('data-smooth')==='true');
await dm.mouse.click(spot[0],spot[1]);
check('a contact can return to a wall',await edge.getAttribute('data-smooth')==='false');
await dm.mouse.click(spot[0],spot[1]);
check('editing the gradient preserves every original outline',JSON.stringify(before)===JSON.stringify(await outlines()));
await dm.getByRole('button',{name:'Apply heights'}).click();
await dm.getByRole('dialog',{name:'Auto height map'}).waitFor({state:'hidden'});
await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.gradientFixed && d.gradient?.length>=2)
  && window.__vtt.board.seenZoneRev===window.__vtt.client.scene.drawRev);
const middle=await dm.evaluate(([x,y])=>window.__vtt.board.groundAtPoint({x:(350+x)/2,y:(300+y)/2}),spot.slice(2));
check('saved slope gives an intermediate standing height',middle>0 && middle<10,String(middle));
await dm.keyboard.press('Control+z');
await dm.waitForFunction(()=>window.__vtt.client.scene.draws.size===1);
console.log(errors.filter((e) => !/GL Driver|404|ReadPixels|GPU stall|willReadFrequently/.test(e)).join('\n') || 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);
