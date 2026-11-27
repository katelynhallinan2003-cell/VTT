import { launch, watch, sleep } from './lib.mjs';
import assert from 'node:assert/strict';
const BASE = (process.env.BASE || 'http://127.0.0.1:4174/') + '?demo';
const errors = [];
const { browser, context } = await launch();
try {
const dm = await context.newPage();
watch(dm, 'dm', errors);
await dm.goto(BASE);
await dm.evaluate(() => localStorage.clear());
await dm.reload();
await dm.getByRole('button', { name: /Start as the DM/ }).click();
await dm.getByPlaceholder('New table name').fill('Bridge openings');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);
const setup=await dm.evaluate(async()=>{
  const {client,board,ui}=window.__vtt;
  await board.chooseGridOverlay('none');
  const at=(x,y)=>board.screenToWorld(x,y);
  const a=at(605,300),b=at(805,585);
  await client.addDrawing({k:'rect',p:[a.x,a.y,b.x,b.y].join(','),hz:10,color:'#fff',w:1,fill:0,dash:false,txt:'',fs:28,bw:5});
  ui.set({tool:'wall',wallMode:'edit'});
  return {entry:at(550,440),deck:at(705,440),exit:at(860,440)};
});
await dm.mouse.click(605,440);
await dm.getByText('Selected wall',{exact:true}).waitFor();
await dm.getByRole('button',{name:'Erase',exact:true}).click();
await dm.mouse.move(550,440); await dm.mouse.down(); await dm.mouse.move(860,440,{steps:6}); await dm.mouse.up();
await dm.waitForFunction(()=>window.__vtt.board.wallSegs().openings.length===2);
const inspect=()=>dm.evaluate(({entry,deck,exit})=>{
  const {board}=window.__vtt, segs=board.wallSegs();
  return {
    through:board.moveCost([entry,exit],false).note,
    onto:board.moveCost([entry,deck],false).note,
    height:board.groundAtPoint(deck),
    sight:segs.sight.filter(s=>(s.a.y>entry.y)!==(s.b.y>entry.y)).length,
    kept:segs.terrain.length,
  };
},setup);
const result=await inspect();
assert.equal(result.through,''); assert.match(result.onto,/10 ft climbing/);
assert.equal(result.height,10); assert.equal(result.sight,0); assert.equal(result.kept,6);
await dm.evaluate(()=>window.__vtt.client.history.undo());
await dm.waitForFunction(()=>!window.__vtt.board.wallSegs().openings.length);
assert.match((await inspect()).through,/20 ft climbing/);
await dm.evaluate(()=>window.__vtt.client.history.redo());
await dm.waitForFunction(()=>window.__vtt.board.wallSegs().openings.length===2);
await dm.reload();
await dm.waitForFunction(()=>window.__vtt?.board?.wallSegs().openings.length===2);
assert.deepEqual(await inspect(),result);
await dm.evaluate(()=>window.__vtt.ui.set({tool:'height',heightMode:'paint'}));
const fine=dm.locator('.terrain-presets').first().getByRole('button',{name:'2',exact:true});
await fine.click();
await dm.mouse.click(900,625);
await dm.waitForFunction(()=>{
  const {client,board}=window.__vtt;
  const stroke=[...client.scene.draws.values()].find(d=>d.k==='terrain' && !d.he);
  return stroke && Math.abs(stroke.w*client.grid.ft/client.grid.cell-2)<0.1 &&
    board.terrainLayer.sprite?.visible && board.terrainLayer.labelBoxes.length>0;
});
assert.ok(await dm.evaluate(()=>!!window.__vtt.board.terrainLayer.worker && !window.__vtt.board.terrainLayer.local));
await dm.evaluate(async()=>{
  const {client,board,ui}=window.__vtt;
  await client.addWalls([{a:board.screenToWorld(625,680),b:board.screenToWorld(850,680),k:'wall',one:0,vis:true,open:false,h:0}]);
  ui.set({tool:'wall',wallMode:'erase'});
});
await dm.mouse.click(730,680);
await dm.waitForFunction(()=>[...window.__vtt.client.wallGeometry().walls.values()].filter(w=>!w.face && w.vis).length===2);
assert.deepEqual(errors.filter(e=>e.includes('pageerror')),[]);
console.log('PASS wall selection, brush gaps, underpass movement and sight, undo, reload, 2 ft brush and rendered terrain');
} finally { await browser.close(); }
