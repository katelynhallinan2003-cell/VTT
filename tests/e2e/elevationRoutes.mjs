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
await dm.getByPlaceholder('New table name').fill('Elevation routes');
await dm.getByRole('button', { name: 'Create table' }).click();
await dm.waitForSelector('.board-host canvas');
await dm.getByRole('button', { name: '+ New scene' }).first().click();
await dm.getByRole('button', { name: 'Use sample dungeon' }).click();
await dm.locator('.modal .muted', { hasText: 'Sample dungeon.png' }).waitFor();
await dm.getByRole('button', { name: 'Create scene' }).click();
await dm.waitForFunction(() => window.__vtt?.board?.mapSprite);
await sleep(400);
const G = await dm.evaluate(() => ({ ...window.__vtt.client.grid }));
const cell = G.cell;
const C = (i, j) => ({ x: G.ox + (i + 0.5) * cell, y: G.oy + (j + 0.5) * cell });
const screen = (p) => dm.evaluate((q) => window.__vtt.board.worldToScreen(q), p);
const near = (a, b, t = 2) => Math.abs(a.x - b.x) <= t && Math.abs(a.y - b.y) <= t;
await dm.evaluate(() => window.__vtt.board.fit());
const start = C(4,8), end = C(16,8);
const token = await dm.evaluate(async ({start,end}) => {
  const {client} = window.__vtt;
  const g = client.grid;
  // Edge of the summit is 60 horizontal feet from the takeoff point.
  await client.addDrawing({k:'rect',p:[end.x,end.y-g.cell,end.x+2*g.cell,end.y+g.cell].join(','),
    color:'#aaaaaa',w:3,fill:0,fc:'',dash:false,txt:'',fs:28,bw:5,hz:40,hg:'summit'});
  return client.addToken({...start,name:'Flyer',fly:true,elev:0});
},{start,end});
await dm.waitForFunction(p => window.__vtt.board.groundAtPoint(p) === 40, end);
await dm.keyboard.press('m');
const pointer = async p => { const v = await screen(p); await dm.mouse.move(v.x,v.y); };
const drag = async (points) => {
  await dm.waitForFunction(({id,p}) => {
    const v = window.__vtt.board.views.get(id);
    return v && Math.hypot(v.display.x-p.x,v.display.y-p.y) < 1;
  },{id:token,p:points[0]});
  await pointer(points[0]); await dm.mouse.down();
  for (const point of points.slice(1)) await pointer(point);
  await dm.waitForFunction(() => window.__vtt.board.distText.visible);
  const before = await dm.evaluate(() => window.__vtt.board.distText.text);
  await dm.mouse.up();
  await dm.waitForFunction(() => !window.__vtt.board.distText.visible);
  const after = await dm.evaluate(() => window.__vtt.board.plotLabels.filter(l => l.visible).map(l => l.text));
  return { before, after };
};
const flight = await drag([start,end]);
check('60 ft horizontal and 40 ft up costs 72.1 ft during the drag and after drop',
  flight.before === '72.1 ft' && flight.after.includes('72.1 ft'), JSON.stringify(flight));
await dm.locator('.testbar button',{hasText:'Reset'}).click();
// The cursor crosses the horizontal and vertical cell boundaries in separate events.
const diagonalPointer = [start];
for (let n=0;n<4;n++) {
  const base = C(4+n,8+n);
  diagonalPointer.push({x:base.x+0.59*cell,y:base.y+0.42*cell}, C(5+n,9+n));
}
await drag(diagonalPointer);
const diagonal = await dm.evaluate(id => window.__vtt.board.testMoves.get(id), token);
check('a diagonal square-grid drag with staggered pointer events records a direct diagonal',
  diagonal?.via.every(p => Math.abs((p.x-start.x)-(p.y-start.y)) < 1) && near(diagonal.to,C(8,12)), JSON.stringify(diagonal));
await dm.locator('.testbar button',{hasText:'Reset'}).click();
await dm.evaluate(async ({token,start}) => {
  const {client} = window.__vtt, g = client.grid;
  await client.updateToken(token,{fly:false});
  await client.addWalls([{a:{x:start.x+3*g.cell,y:start.y-g.cell},b:{x:start.x+3*g.cell,y:start.y+g.cell},
    k:'wall',h:10,one:0,open:false,vis:true}]);
},{token,start});
const target = C(10,8);
const direct = await drag([start,target]);
check('direct crossing charges both faces', direct.before === '50 ft · 30 ft normal + 20 ft climbing', JSON.stringify(direct));
await dm.locator('.testbar button',{hasText:'Reset'}).click();
const bypass = await drag([start,C(4,6),C(10,6),target]);
check('one continuous drag around the wall keeps both turns and its 50 ft total after drop',
  bypass.before === '50 ft' && bypass.after.includes('50 ft'), JSON.stringify(bypass));
const trace = await dm.evaluate(id => window.__vtt.board.testMoves.get(id), token);
check('the saved turn positions follow the route around the wall',
  trace?.via.length === 2 && near(trace.via[0],C(4,6)) && near(trace.via[1],C(10,6)), JSON.stringify(trace));
await dm.keyboard.press('m');
await dm.setViewportSize({width:1366,height:768});
await dm.keyboard.press('h');
const tints = await dm.evaluate(async () => {
  const {client,board} = window.__vtt;
  const g = client.grid, y = 8.5*g.cell+g.oy;
  for (let i = 0; i < 2; i++) {
    const x = (7+i*3)*g.cell+g.ox;
    await client.addDrawing({k:'rect',p:[x,y-g.cell,x+2*g.cell,y+g.cell].join(','),
      w:3,color:'#aaaaaa',hz:10+i*10});
  }
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const {canvas,sprite} = board.terrainLayer;
  const ctx = canvas.getContext('2d');
  return [8,11,17].map(i => [...ctx.getImageData(Math.floor((g.ox+i*g.cell-sprite.x)*canvas.width/sprite.width),
    Math.floor((y-sprite.y)*canvas.height/sprite.height),1,1).data]);
});
check('three finished elevations have distinct translucent colours', new Set(tints.map(c=>c.slice(0,3).join(','))).size === 3 &&
  tints.every(c=>c[3]>0 && c[3]<200), JSON.stringify(tints));
await dm.screenshot({path:'/tmp/shots/elevation-heights.png'});
// One stroke covers both the plateau and a detached island. A separate group
// touches the plateau, and a higher cell cuts its far end off.
const samples = [C(8,12),C(9,12),C(10,12),C(11,12),C(12,12),C(15,12)];
await dm.evaluate(async points => {
  const {client} = window.__vtt;
  const paint = (group,height,cells) => client.addDrawing({k:'terrain',hg:group,hz:height,hc:true,
    p:cells.map(p => [p.x,p.y].join(',')).join(','),w:client.grid.cell,color:'#aaaaaa'});
  await paint('plateau',30,[points[0],points[1],points[5]]);
  await paint('extension',30,points.slice(2,5));
  await paint('divider',40,[points[3]]);
},samples);
await dm.waitForFunction(p => window.__vtt.board.groundAtPoint(p) === 40,samples[3]);
const click = await screen(samples[1]);
await dm.keyboard.down('Control');
await dm.mouse.click(click.x,click.y);
await dm.keyboard.up('Control');
const selected = await dm.evaluate(() => window.__vtt.ui.data.heightPatches?.[0]);
check('Ctrl-click selects through the touching brush boundary',selected?.height === 30 && selected.cuts.length === 2);
await dm.locator('.ht-card .numf input').fill('35');
await dm.locator('.ht-card .numf input').press('Enter');
await dm.waitForFunction(p => window.__vtt.board.groundAtPoint(p) === 35,samples[0]);
const heights = () => dm.evaluate(ps => ps.map(p => window.__vtt.board.groundAtPoint(p)),samples);
check('editing the selection stops at the higher divider and leaves the detached island alone',
  (await heights()).join(',') === '35,35,35,40,30,30');
await dm.locator('.ht-card .numf input').blur();
await dm.keyboard.press('Control+z');
await dm.waitForFunction(p => window.__vtt.board.groundAtPoint(p) === 30,samples[0]);
check('undo restores all selected fragments together',(await heights()).join(',') === '30,30,30,40,30,30');
await dm.keyboard.press('b');
await dm.getByRole('button',{name:'Freehand',exact:true}).click();
check('wall controls fit the laptop menu', await dm.locator('.flyout .seg button').evaluateAll(buttons =>
  buttons.every(b => b.scrollWidth <= b.clientWidth+1 && b.scrollHeight <= b.clientHeight+1)));
await dm.locator('.flyout').screenshot({path:'/tmp/shots/elevation-walls.png'});
await browser.close();
console.log(errors.length ? errors.join('\n') : 'no console problems');
console.log(`${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.includes(false) || errors.some(e => e.includes('pageerror')) ? 1 : 0);
