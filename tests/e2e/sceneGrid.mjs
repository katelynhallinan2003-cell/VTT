import assert from 'node:assert/strict';
import {launch} from './lib.mjs';

const {browser,context}=await launch();
try {
  const dm=await context.newPage();
  await dm.goto((process.env.BASE || 'http://127.0.0.1:4174/')+'?demo');
  await dm.getByRole('button',{name:/Start as the DM/}).click();
  await dm.getByPlaceholder('New table name').fill('Scene grids');
  await dm.getByRole('button',{name:'Create table'}).click();
  await dm.waitForFunction(()=>window.__vtt?.board);
  const scenes=await dm.evaluate(async()=>{
    const {client,ui}=window.__vtt;
    const ids=[];
    for(const name of ['Courtyard','Grotto','Canopy','Cavern']) ids.push(await client.createScene({name}));
    ui.set({dockTab:'scene'});
    return ids;
  });
  const choices=['Squares','Hex, rows','Hex, columns','Gridless'];
  const pick=async i=>{
    await dm.getByRole('combobox',{name:'Scene',exact:true}).selectOption(scenes[i]);
    await dm.waitForFunction(id=>window.__vtt.board.sceneRef?.id===id && window.__vtt.client.scene?.meta,scenes[i]);
  };
  const button=i=>dm.getByRole('group',{name:'Grid type'}).getByRole('button',{name:choices[i],exact:true});
  for(let i=0;i<scenes.length;i++) {
    await pick(i); await button(i).click();
    await dm.waitForFunction(label=>document.querySelector('.grid-choices [aria-pressed="true"]')?.textContent===label,choices[i]);
  }
  for(const i of [1,3,0,2,1]) {
    await pick(i);
    assert.equal(await button(i).getAttribute('aria-pressed'),'true');
  }
  console.log('PASS switching scenes restores each saved grid type in the Scene panel');
} finally {await browser.close();}
