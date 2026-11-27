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
await dm.getByRole('button',{name:'Make Gradient',exact:true}).click();
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
assert.ok(await fields.nth(1).evaluate(el=>el===document.activeElement));
await dm.keyboard.type('30'); await dm.keyboard.press('Enter');
await dm.waitForFunction(()=>Math.abs(window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(850,465))-30)<0.1);

const shelf=await dm.evaluate(async()=>{
  const {client,board}=window.__vtt;
  const a=board.screenToWorld(960,250), b=board.screenToWorld(1060,660);
  return client.addDrawing({k:'terrain',hg:'shelf',hz:18,hr:'5',p:[a.x,a.y,b.x,a.y,b.x,b.y,a.x,b.y,a.x,a.y].join(','),
    color:'#fff',w:1,fill:0,dash:false,txt:'',fs:28,bw:5});
});
await dm.waitForFunction(()=>document.querySelectorAll('.gradient-box').length===3);
assert.equal(await fields.first().inputValue(),'18');
await fields.first().fill('22'); await fields.first().press('Enter');
await dm.waitForFunction(()=>window.__vtt.board.gradientControls(window.__vtt.ui.data.gradientArea)[0].height===22);
await dm.evaluate(shelf=>window.__vtt.client.removeDrawings([shelf]),shelf);
await dm.waitForFunction(()=>window.__vtt.board.groundAtPoint(window.__vtt.board.screenToWorld(995,450))===0);
await dm.getByRole('button',{name:'Done',exact:true}).click();
await dm.getByRole('button',{name:'Edit Gradient',exact:true}).click();
assert.equal(await fields.count(),2);
await dm.getByRole('button',{name:'Delete height point'}).nth(1).click();
await dm.waitForFunction(() => document.querySelectorAll('.gradient-box').length===1);
await dm.getByRole('button',{name:'Diff Terrain',exact:true}).click();
await dm.getByText('Difficult terrain',{exact:true}).waitFor();
assert.equal(await dm.getByRole('button',{name:'Clear difficult ground'}).count(),0);
await dm.evaluate(async()=>{const {board}=window.__vtt; await board.chooseGridOverlay('none');});
await dm.mouse.move(630,390); await dm.mouse.down(); await dm.mouse.move(740,430,{steps:4}); await dm.mouse.up();
await dm.getByRole('button',{name:'Clear difficult ground'}).waitFor();
assert.ok(await dm.evaluate(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.dt && !d.hc)));
await dm.getByRole('checkbox',{name:'Always show terrain'}).check();
assert.equal(await dm.evaluate(()=>window.__vtt.ui.data.heightView),'always');
assert.deepEqual(errors.filter(e=>e.includes('pageerror')),[]);
console.log('PASS gradient placement, heights, line conversion, drag, deletion and gridless difficult terrain');
} finally { await browser.close(); }
