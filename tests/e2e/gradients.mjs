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
await dm.getByPlaceholder('New table name').fill('Elevation routes');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);

await dm.evaluate(async () => {
  const {board,client,ui} = window.__vtt;
  const a=board.screenToWorld(500,270), b=board.screenToWorld(1020,640);
  const id=await client.addDrawing({k:'rect',p:[a.x,a.y,b.x,b.y].join(','),hz:5,color:'#fff',w:1,fill:0,dash:false,txt:'',fs:28,bw:5});
  ui.set({tool:'height',drawSel:new Set([id])});
});
const cursor = () => dm.locator('.board-host canvas').evaluate(canvas => getComputedStyle(canvas).cursor);
await dm.getByRole('button',{name:'Paint',exact:true}).click();
assert.equal(await cursor(),'crosshair');
await dm.getByRole('button',{name:'Erase',exact:true}).click();
assert.equal(await dm.locator('.ht-card').count(),0);
await dm.getByRole('button',{name:'Select',exact:true}).click();
assert.equal(await cursor(),'default');
await dm.mouse.move(570,410);
assert.equal(await cursor(),'default');
assert.equal(await dm.locator('.ht-card strong').innerText(),'Set Height');
const card = dm.locator('.ht-card');
assert.equal(await card.getByRole('button',{name:/^(Exact height|Added on top)$/}).count(),0);
const added = await dm.evaluate(async () => {
  const {board,client,ui} = window.__vtt;
  const p = board.screenToWorld(710,410);
  const id = await client.addDrawing({k:'terrain',hg:'rise',hz:10,ha:true,p:[p.x,p.y].join(','),w:60,color:'#fff',fill:0});
  ui.selectDrawings([id]);
  return id;
});
const heightAtDab = height => dm.waitForFunction(h => {
  const {board} = window.__vtt;
  return board.groundAtPoint(board.screenToWorld(710,410)) === h;
},height);
await heightAtDab(15);
const heightField = card.locator('input[type="number"]');
assert.equal(await heightField.inputValue(),'15');
await heightField.fill('20');
await heightField.press('Enter');
await heightAtDab(20);
await dm.evaluate(()=>window.__vtt.client.history.undo());
await heightAtDab(15);
await dm.mouse.click(710,410);
await card.getByRole('button',{name:'25',exact:true}).click();
await heightAtDab(25);
await dm.evaluate(()=>window.__vtt.client.history.undo());
await heightAtDab(15);
await dm.evaluate(id=>window.__vtt.client.removeDrawings([id]),added);
await heightAtDab(5);
await dm.mouse.click(710,410);
await dm.locator('.ht-card').getByRole('button',{name:'Done'}).click();
assert.equal(await dm.locator('.ht-card').count(),0);
await dm.mouse.click(710,410);
assert.equal(await dm.locator('.ht-card strong').innerText(),'Set Height');
await dm.getByRole('button',{name:'Make Gradient',exact:true}).click();
await dm.getByRole('button',{name:'Select',exact:true,pressed:true}).waitFor();
const fields = dm.getByRole('spinbutton',{name:'Gradient height'});
await dm.mouse.click(502,600);
await fields.nth(0).waitFor();
await fields.nth(0).fill('5');
await fields.nth(0).press('Enter');
await dm.mouse.click(920,465);
await fields.nth(1).waitFor();
await dm.waitForFunction(()=>document.activeElement===document.querySelectorAll('.gradient-box input')[1]);
await dm.keyboard.type('25');
await dm.keyboard.press('Enter');
await dm.getByRole('button',{name:'To line',exact:true}).first().click({timeout:2500});
const end=dm.getByRole('button',{name:'Move line end'});
await end.waitFor();
const endBox=await end.boundingBox();
assert.ok(endBox);
await dm.mouse.move(endBox.x+endBox.width/2,endBox.y+endBox.height/2);
await dm.mouse.down(); await dm.mouse.move(501,360,{steps:5}); await dm.mouse.up();
await dm.waitForFunction(() => {
  const {board}=window.__vtt;
  const h=board.groundAtPoint(board.screenToWorld(710,465));
  return h>14.8 && h<15.2;
});
const dot=dm.getByRole('button',{name:'Move height point'}).nth(1);
const box=await dot.boundingBox();
await dm.mouse.move(box.x+box.width/2,box.y+box.height/2);
await dm.mouse.down(); await dm.mouse.move(850,465,{steps:4}); await dm.mouse.up();
await dm.waitForFunction(() => {
  const {board}=window.__vtt;
  return Math.abs(board.groundAtPoint(board.screenToWorld(850,465))-25)<0.1;
});
await dot.click();
assert.equal(await dot.evaluate(el=>el.parentElement.classList.contains('gradient-selected')),true);
const lineBox = dm.locator('.gradient-box').first();
const borderColor = () => lineBox.evaluate(el=>getComputedStyle(el).borderTopColor);
const idleColor = await borderColor();
await lineBox.getByRole('button',{name:'To point'}).hover();
assert.equal(await borderColor(),'rgb(255, 82, 186)');
assert.equal(await end.evaluate(el=>getComputedStyle(el,'::after').backgroundColor),'rgb(255, 82, 186)');
await dm.mouse.move(710,410);
assert.equal(await borderColor(),idleColor);
assert.equal(await dot.evaluate(el=>el.parentElement.classList.contains('gradient-selected')),true);
await fields.first().click();
assert.equal(await fields.first().evaluate(el=>el.closest('.gradient-selected')!==null),true);
assert.equal(await dot.evaluate(el=>el.parentElement.classList.contains('gradient-selected')),false);
await dot.click();
assert.ok(await fields.nth(1).evaluate(el=>el===document.activeElement));
await dm.keyboard.type('30'); await dm.keyboard.press('Enter');
await dm.waitForFunction(()=>Math.abs(window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(850,465))-30)<0.1);

const original=await dm.evaluate(()=>{
  const {ui,board}=window.__vtt;
  return {controls:board.gradientControls(ui.data.gradientArea),height:board.groundAtPoint(board.screenToWorld(995,450))};
});
const shelf=await dm.evaluate(async()=>{
  const {client,board}=window.__vtt;
  const a=board.screenToWorld(960,250), b=board.screenToWorld(1060,660);
  return client.addDrawing({k:'terrain',hg:'shelf',hz:18,hr:'5',p:[a.x,a.y,b.x,a.y,b.x,b.y,a.x,b.y,a.x,a.y].join(','),
    color:'#fff',w:1,fill:0,dash:false,txt:'',fs:28,bw:5});
});
await dm.waitForFunction(()=>window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(995,450))===18);
assert.deepEqual(await dm.evaluate(()=>{const {ui,board}=window.__vtt;return board.gradientControls(ui.data.gradientArea);}),original.controls);
// Click just on the painted side. The point and its converted line belong to the gradient
// and follow the exposed seam, while its two original controls remain exactly as saved.
await dm.mouse.click(965,465);
await fields.nth(2).waitFor();
assert.equal(await fields.nth(2).inputValue(),'18');
await dm.locator('.gradient-box').nth(2).getByRole('button',{name:'To line'}).click();
await dm.waitForFunction(()=>{
  const {board,ui}=window.__vtt, control=board.gradientControls(ui.data.gradientArea)[2];
  return control?.path.length>=2 && control.path.every(p=>Math.abs(board.worldToScreen(p).x-960)<0.5);
});
assert.deepEqual(await dm.evaluate(()=>{const {ui,board}=window.__vtt;return board.gradientControls(ui.data.gradientArea).slice(0,2);}),original.controls);
await dm.getByRole('button',{name:'Delete height point'}).nth(2).click();
await dm.waitForFunction(()=>document.querySelectorAll('.gradient-box').length===2);
await dm.evaluate(shelf=>window.__vtt.client.removeDrawings([shelf]),shelf);
await dm.waitForFunction(h=>window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(995,450))===h,original.height);
await dm.getByRole('button',{name:'Done',exact:true}).click();
assert.equal(await fields.count(),0);
assert.equal(await dm.evaluate(()=>window.__vtt.ui.data.drawSel.size),0);
await dm.mouse.click(700,490);
await fields.nth(1).waitFor();
assert.equal(await dm.getByRole('button',{name:'Fill all holes',exact:true}).count(),0);
// A painted island in the old rectangle gradient leaves the controls and the deck intact.
await dm.evaluate(async()=>{
  const {board,client}=window.__vtt;
  const a=board.screenToWorld(715,380), b=board.screenToWorld(755,420);
  await client.addDrawing({k:'terrain',hg:'island',hz:45,hr:'5',p:[a.x,a.y,b.x,a.y,b.x,b.y,a.x,b.y,a.x,a.y].join(','),
    color:'#fff',w:1,fill:0,dash:false,txt:'',fs:28,bw:5});
});
const islandHeight=()=>dm.evaluate(()=>window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(735,400)));
await dm.waitForFunction(()=>window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(735,400))===45);
assert.equal(await dm.getByRole('button',{name:'Fill unpainted holes',exact:true}).count(),0);
assert.equal(await islandHeight(),45);
await dm.getByRole('button',{name:'Fill all holes',exact:true}).click();
await dm.waitForFunction(()=>{const {board}=window.__vtt;const h=board.groundAtPoint(board.screenToWorld(735,400));return h>5 && h<30;});
await dm.evaluate(()=>window.__vtt.client.history.undo());
await dm.waitForFunction(()=>window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(735,400))===45);
await dm.evaluate(()=>window.__vtt.client.history.redo());
await dm.waitForFunction(()=>document.querySelectorAll('.gradient-box').length===2);
await dm.getByRole('button',{name:'Delete height point'}).nth(1).click();
await dm.waitForFunction(() => document.querySelectorAll('.gradient-box').length===1);
const advanced = dm.locator('.terrain-menu details');
const clearHeights = advanced.getByRole('button',{name:'Clear all heights',includeHidden:true});
assert.equal(await clearHeights.count(),1);
assert.equal(await clearHeights.isVisible(),false);
await advanced.locator('summary').click();
assert.equal(await clearHeights.isVisible(),true);
await advanced.locator('summary').click();
await dm.getByRole('button',{name:'Diff Terrain',exact:true}).click();
await dm.getByText('Difficult terrain',{exact:true}).waitFor();
assert.equal(await dm.getByRole('button',{name:'Clear all difficult terrain'}).count(),0);
await dm.evaluate(async()=>{const {board}=window.__vtt; await board.chooseGridOverlay('none');});
await dm.mouse.move(630,390); await dm.mouse.down(); await dm.mouse.move(740,430,{steps:4}); await dm.mouse.up();
const clearRough = advanced.getByRole('button',{name:'Clear all difficult terrain',includeHidden:true});
await clearRough.waitFor({state:'attached'});
assert.equal(await clearRough.isVisible(),false);
assert.ok(await dm.evaluate(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.dt && !d.hc)));
await dm.waitForFunction(() => {
  const {board} = window.__vtt;
  if (!board.rough.areas.length) return false;
  const {pixels,width,height} = board.app.renderer.extract.pixels(board.roughG);
  const row = 4*width*Math.floor(height/2);
  let stripes = 0, wasInk = false;
  for (let x=0; x<width; x++) {
    const i = row+4*x, ink = pixels[i+3] > 75;
    if (ink && Math.max(pixels[i],pixels[i+1],pixels[i+2]) > 8) return false;
    if (ink && !wasInk) stripes++;
    wasInk = ink;
  }
  return stripes >= 2;
});
await dm.locator('.terrain-menu summary',{hasText:'Advanced'}).click();
await clearRough.click();
await clearRough.waitFor({state:'detached'});
await dm.getByRole('checkbox',{name:'Always show terrain',exact:true}).check();
assert.equal(await dm.evaluate(()=>window.__vtt.ui.data.heightView),'always');
// Sample the actual overlay across a flat 0 ft / 0–5 ft slope / flat 5 ft join, with nothing selected.
await dm.evaluate(async()=>{
  const {client,ui}=window.__vtt;
  await client.createScene({name:'Slope joins',makeActive:true});
  const rect=(x,right,h)=>({k:'rect',p:[x,0,right,200].join(','),hz:h,color:'#fff',w:1,fill:0,dash:false,txt:'',fs:28,bw:5});
  await client.addDrawings([rect(0,100,0),{...rect(100,400,0),gradientEnabled:true,gradientFixed:true,
    gradient:[{id:'low',height:0,path:[{x:100,y:0},{x:100,y:200}]},{id:'high',height:5,path:[{x:400,y:0},{x:400,y:200}]}]},
    rect(400,500,5),rect(500,600,15)]);
  ui.set({tool:'select',drawSel:new Set(),heightView:'always'});
});
await dm.waitForFunction(()=>{
  const {board}=window.__vtt;
  return board.zones.areas.length===4 && board.terrainLayer.levels.includes(15) && !board.terrainLayer.running && board.heightFade===1;
});
const samples=await dm.evaluate(()=>{
  const layer=window.__vtt.board.terrainLayer, sprite=layer.sprite, ctx=layer.canvas.getContext('2d');
  return [90,99,100,103,240,398,400,410,499,500].map(x=>Array.from(ctx.getImageData(
    Math.floor((x-sprite.x)/sprite.scale.x),Math.floor((100-sprite.y)/sprite.scale.y),1,1).data));
});
const difference=(a,b)=>Math.max(...a.map((v,i)=>Math.abs(v-b[i])));
assert.ok(difference(samples[1],samples[2])<=4 && difference(samples[5],samples[6])<=4,JSON.stringify(samples));
assert.ok(difference(samples[0],samples[3])<=5 && difference(samples[0],samples[4])>10,JSON.stringify(samples));
assert.ok(difference(samples[8],samples[9])>12,JSON.stringify(samples));

// Player visibility is a live scene setting, independent of the DM's own overlay.
await dm.evaluate(()=>window.__vtt.ui.set({tool:'height',groundKind:'height',heightView:'auto'}));
const shared=dm.getByRole('checkbox',{name:'Always show terrain to players',exact:true});
if (!await shared.isVisible()) await dm.locator('.terrain-menu summary',{hasText:'Advanced'}).click();
assert.equal(await shared.isChecked(),false);
const pl=await context.newPage();
watch(pl,'player',errors);
await pl.goto(BASE+await dm.evaluate(()=>location.hash));
await pl.getByPlaceholder('e.g. Aria').fill('Aria');
await pl.getByRole('button',{name:'Join table'}).click();
await pl.waitForFunction(()=>window.__vtt?.client?.scene?.meta?.name==='Slope joins');
await shared.check();
await dm.evaluate(()=>window.__vtt.ui.set({tool:'select'}));
await pl.waitForFunction(()=>window.__vtt.board.heightFade===1 && window.__vtt.board.roughG.visible);
await dm.waitForFunction(()=>window.__vtt.board.heightFade===0);
await pl.reload();
await pl.waitForFunction(()=>window.__vtt?.board?.heightFade===1);
await dm.evaluate(()=>window.__vtt.ui.set({tool:'height'}));
if (!await shared.isVisible()) await dm.locator('.terrain-menu summary',{hasText:'Advanced'}).click();
await shared.uncheck();
await pl.waitForFunction(()=>window.__vtt.board.heightFade===0 && !window.__vtt.board.roughG.visible);
assert.deepEqual(errors.filter(e=>e.includes('pageerror')),[]);
console.log('PASS gradient placement, heights, line conversion, drag, deletion and gridless difficult terrain');
} finally { await browser.close(); }
