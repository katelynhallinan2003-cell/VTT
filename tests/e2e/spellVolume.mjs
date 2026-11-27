// Focused browser check for placement defaults, per-spell overrides, and token altitude.
import assert from 'node:assert/strict';
import { launch } from './lib.mjs';
const { browser,context }=await launch();
try {
  const dm=await context.newPage();
  const errors=[];
  dm.on('pageerror',e=>errors.push(e.message));
  await dm.goto((process.env.BASE || 'http://127.0.0.1:4174/')+'?demo');
  await dm.getByRole('button',{name:/Start as the DM/}).click();
  await dm.getByPlaceholder('New table name').fill('Spell volume test');
  await dm.getByRole('button',{name:'Create table'}).click();
  await dm.getByRole('button',{name:'+ New scene'}).first().click();
  await dm.getByRole('button',{name:'Use sample dungeon'}).click();
  await dm.locator('.modal .muted',{hasText:'Sample dungeon.png'}).waitFor();
  await dm.getByRole('button',{name:'Create scene'}).click();
  await dm.waitForFunction(()=>window.__vtt?.board?.mapSprite);
  await dm.evaluate(()=>window.__vtt.ui.set({tool:'select',tplMode:'select'}));
  await dm.getByRole('button',{name:'Spell templates',exact:true}).click();
  const menu=dm.locator('.flyout');
  const clear=menu.getByRole('button',{name:'Clear all templates'});
  assert.equal(await clear.count(),0);
  await menu.getByRole('button',{name:'Sphere',exact:true}).click();
  assert(await menu.getByLabel('Starting elevation (ft)').isVisible());
  await menu.locator('summary',{hasText:'Advanced'}).click();
  assert(await menu.getByLabel('Consider walls',{exact:true}).isChecked());
  await menu.getByLabel('Consider walls',{exact:true}).uncheck();
  assert.equal(await menu.getByText('Wrap around corners',{exact:true}).count(),0);
  await menu.getByLabel('Consider walls',{exact:true}).check();
  assert.equal(await menu.getByLabel('Ending elevation (ft)').count(),0);
  const start=menu.getByLabel('Starting elevation (ft)');
  await start.fill('120');await start.press('Enter');
  const {a,b,token}=await dm.evaluate(async()=>{
    const {client,board}=window.__vtt, m=client.scene.meta, g=client.grid;
    const p={x:m.mapX+m.mapW*m.mapScale*.56,y:m.mapY+m.mapH*m.mapScale*.43};
    const token=await client.addToken({...p,name:'Target',size:1});
    return {a:board.worldToScreen(p),b:board.worldToScreen({x:p.x+g.cell*3,y:p.y}),token};
  });
  const place=async()=>{
    await dm.mouse.move(a.x,a.y);await dm.mouse.down();await dm.mouse.move(b.x,b.y,{steps:5});await dm.mouse.up();
  };
  await place();
  await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.k==='sphere' && d.spell?.start===120));
  const colors=()=>dm.evaluate(id=>window.__vtt.board.spellColors(window.__vtt.client.scene.tokens.get(id)),token);
  assert.equal((await colors()).length,0);
  await start.fill('0');await start.press('Enter');
  await place();
  await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].filter(d=>d.k==='sphere').length===2);
  assert.deepEqual(await dm.evaluate(()=>[...window.__vtt.client.scene.draws.values()].filter(d=>d.k==='sphere').map(d=>d.color)),['#e03131','#f08c00']);
  assert(await clear.evaluate(el=>el.classList.contains('danger') && !!(el.compareDocumentPosition(el.closest('.flyout').querySelector('details')) & Node.DOCUMENT_POSITION_FOLLOWING)));
  assert.equal((await colors()).length,1);
  await menu.getByRole('button',{name:'Select',exact:true}).click();
  await dm.mouse.dblclick(a.x,a.y);
  assert(await dm.evaluate(id=>window.__vtt.ui.data.selection.has(id) && !window.__vtt.ui.data.drawSel.size,token));
  await dm.evaluate(()=>window.__vtt.ui.set({tool:'select'}));
  await dm.mouse.dblclick((a.x+b.x)/2,a.y);
  assert(await dm.evaluate(()=>window.__vtt.ui.data.tplMode==='select' && window.__vtt.ui.data.drawSel.size===1));
  const selected=dm.locator('.drawtag');
  assert(await selected.getByRole('spinbutton',{name:/Radius/}).isVisible());
  assert(await selected.getByLabel('Starting elevation (ft)').isVisible());
  await selected.locator('summary',{hasText:'Advanced'}).click();
  const own=selected.getByLabel('Starting elevation (ft)');
  await own.fill('120');await own.press('Enter');
  await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].every(d=>d.k!=='sphere'||d.spell?.start===120));
  assert.equal((await colors()).length,0);
  await dm.evaluate(id=>window.__vtt.client.updateTokens([id],{fly:true,elev:120}),token);
  await dm.waitForFunction(id=>window.__vtt.board.spellColors(window.__vtt.client.scene.tokens.get(id)).length===2,token);
  await dm.reload();
  await dm.waitForFunction(()=>window.__vtt?.client?.scene?.draws?.size>=2);
  assert.equal((await colors()).length,2);
  await dm.getByRole('button',{name:'Spell templates',exact:true}).click();
  await menu.getByRole('button',{name:'Place',exact:true}).click();
  await menu.getByRole('button',{name:'Line',exact:true}).click();
  await menu.locator('input[type=color]').fill('#813ec9');
  const width=menu.getByRole('spinbutton',{name:/Line width/});
  await menu.getByLabel('Line width presets').selectOption('20');
  assert.equal(await width.inputValue(),'20');
  await width.fill('12.5');await width.press('Enter');
  await place();
  await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.k==='beam' && d.bw===12.5));
  assert.equal(await menu.locator('input[type=color]').inputValue(),'#813ec9');
  assert(await dm.evaluate(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.k==='beam' && d.color==='#813ec9')));
  const endpoint=await dm.evaluate(()=>{
    const {board,client}=window.__vtt;
    const line=[...client.scene.draws.values()].find(d=>d.k==='beam');
    const [x,y,endX,endY]=line.p.split(',').map(Number);
    return board.worldToScreen({x:(x+endX)/2,y:(y+endY)/2});
  });
  await dm.mouse.dblclick(endpoint.x,endpoint.y);
  const placedWidth=dm.locator('.drawtag').getByRole('spinbutton',{name:/Line width/});
  await placedWidth.fill('8.25');await placedWidth.press('Enter');
  await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.k==='beam' && d.bw===8.25));
  const length=selected.getByRole('spinbutton',{name:/Length/});
  await length.fill('59');await length.press('Enter');
  await dm.waitForFunction(()=>[...window.__vtt.client.scene.draws.values()].some(d=>d.k==='beam' && d.spell.range===60));
  await selected.locator('summary',{hasText:'Advanced'}).click();
  const origin=selected.getByLabel('Starting elevation (ft)');
  const end=selected.getByLabel('Ending elevation (ft)');
  assert.equal(await origin.inputValue(),'0');
  assert.equal(await end.inputValue(),'0');
  assert.equal((await origin.boundingBox()).y,(await end.boundingBox()).y);
  await end.fill('36');await end.press('Enter');
  const projected=await dm.evaluate(()=>{
    const {board,client}=window.__vtt;
    const line=[...client.scene.draws.values()].find(d=>d.k==='beam'),[x,y]=line.p.split(',').map(Number);
    const [tip]=board.drawingHandles(line);
    return Math.hypot(tip.x-x,tip.y-y)*client.grid.ft/client.grid.cell;
  });
  assert(Math.abs(projected-(48+.6*8.25/2))<0.01);
  assert.equal(await length.inputValue(),'60');
  const resized=await dm.evaluate(()=>{
    const {board,client}=window.__vtt, line=[...client.scene.draws.values()].find(d=>d.k==='beam');
    const [x,y]=line.p.split(',').map(Number), [tip]=board.drawingHandles(line);
    return board.templateSnap('beam',{x,y},tip,{},undefined,line).range;
  });
  assert.equal(resized,60);
  await dm.evaluate(async()=>{
    const {client}=window.__vtt, line=[...client.scene.draws.values()].find(d=>d.k==='beam');
    const [x,y]=line.p.split(',').map(Number);
    await client.updateDrawings([line.id],{p:[x,y,x+100,y+45].join(',')});
  });
  await dm.waitForFunction(()=>{
    const {board,client}=window.__vtt, line=[...client.scene.draws.values()].find(d=>d.k==='beam');
    const polygons=g=>g.context.instructions.filter(i=>i.action==='stroke').flatMap(i=>i.data.path.instructions)
      .filter(i=>i.action==='poly').map(i=>JSON.stringify(i.data[0]));
    const rendered=polygons(board.drawLayer.items.get(line.id).g);
    return polygons(board.overlayG).some(p=>rendered.includes(p));
  });
  for(const shape of ['square','flat','pointy']) {
    await dm.evaluate(async shape=>{
      const {client}=window.__vtt;
      await client.updateScene({grid:{...client.grid,shape,ft:10,visible:true,snap:true}});
    },shape);
    const snapped=await dm.evaluate(()=>{
      const {board,client}=window.__vtt, a=board.viewCenterWorld(), step=client.grid.cell;
      const result=board.templateSnap('beam',a,{x:a.x+step*2.4,y:a.y+step*.6},{});
      return result.range;
    });
    assert(snapped>0 && snapped%5===0);
  }
  await clear.click();
  await clear.waitFor({state:'detached'});
  assert.deepEqual(errors,[]);
  console.log('Passed spell controls, token hits, reload, fixed spatial range, projected outlines, and square/hex snapping.');
} finally { await browser.close(); }
