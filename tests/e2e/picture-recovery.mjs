import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { launch } from './lib.mjs';

const { browser, context } = await launch();
try {
  const page = await context.newPage();
  const old = 'https://i.ibb.co/old/map.png', next = 'https://i.ibb.co/new/map.png';
  let image, placeholder, uploads = 0;
  let available = next;
  await context.route('https://i.ibb.co/**', route => route.fulfill(route.request().url() === available
    ? { status: 200, contentType: 'image/png', body: image, headers: { 'Access-Control-Allow-Origin': '*' } }
    : route.request().url()===next
      ? { status:200, contentType:'image/png',body:placeholder,headers:{'Access-Control-Allow-Origin':'*'} }
      : { status: 404, body: '', headers: { 'Access-Control-Allow-Origin': '*' } }));
  await context.route('https://api.imgbb.com/**', route => {
    uploads++;
    return route.fulfill({ json: {success:true,data:{url:available,width:100,height:80}},headers:{'Access-Control-Allow-Origin':'*'} });
  });
  if (!process.env.BASE) await context.route('https://table.test/**', async route => {
    const path = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    const types = { js:'text/javascript', css:'text/css', html:'text/html', json:'application/json' };
    try { await route.fulfill({ body:await readFile(new URL('../../dist/'+path,import.meta.url)), contentType:types[path.split('.').pop()] }); }
    catch { await route.fulfill({status:404,body:''}); }
  });
  await page.goto((process.env.BASE || 'https://table.test/') + '?demo');
  await page.getByRole('button',{name:/Start as the DM/}).click();
  await page.getByPlaceholder('New table name').fill('Artwork test');
  await page.getByRole('button',{name:'Create table'}).click();
  await page.waitForSelector('.board-host canvas');
  image = Buffer.from(await page.evaluate(() => {
    const canvas=document.createElement('canvas');
    canvas.width=100; canvas.height=80;
    const ctx=canvas.getContext('2d'); ctx.fillStyle='green'; ctx.fillRect(0,0,100,80);
    return canvas.toDataURL().split(',')[1];
  }),'base64');
  placeholder=Buffer.from(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=180;
    const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(39,167,224)';ctx.fillRect(0,0,180,180);
    ctx.fillStyle='white';ctx.fillRect(65,80,35,16);
    return canvas.toDataURL().split(',')[1];
  }),'base64');
  const before=await page.evaluate(async url => {
    const c=window.__vtt.client;
    const id=await c.createScene({name:'Crypt',mapUrl:url,mapW:100,mapH:80,gridTried:true});
    await c.updateScene({mapX:130,mapY:40,mapScale:1.3,mapLocked:false});
    await c.addToken({x:148,y:60,name:'Scout',size:1});
    await c.backend.set('tables/'+c.tableId+'/upload/key','mock');
    return await c.backend.get('tables/'+c.tableId+'/scenes/'+id);
  },old);
  await page.getByText('Repair missing artwork',{exact:true}).waitFor({timeout:40000});
  const wrong=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;return canvas.toDataURL().split(',')[1];});
  await page.getByLabel('Original picture').setInputFiles({name:'wrong.png',mimeType:'image/png',buffer:Buffer.from(wrong,'base64')});
  await page.getByRole('alert').filter({hasText:'100 × 80'}).waitFor();
  assert.equal(uploads,0);
  await page.getByLabel('Original picture').setInputFiles({name:'map.png',mimeType:'image/png',buffer:image});
  await page.waitForFunction(url => window.__vtt.client.scene.meta.mapUrl===url && !!window.__vtt.board.mapSprite,next);
  const after=await page.evaluate(async () => {
    const c=window.__vtt.client;
    return await c.backend.get('tables/'+c.tableId+'/scenes/'+c.scene.id);
  });
  assert.deepEqual(after,{...before,meta:{...before.meta,mapUrl:next}});
  assert.equal(uploads,1);
  available = 'https://i.ibb.co/restored/map.png';
  const player=await context.newPage();
  await player.goto(page.url());
  await player.getByPlaceholder('e.g. Aria').fill('Aria');
  await player.getByRole('button',{name:'Join table'}).click();
  await page.waitForFunction(url => window.__vtt.client.scene.meta.mapUrl===url && !!window.__vtt.board.mapSprite,available);
  await player.waitForFunction(url => window.__vtt.client.scene.meta.mapUrl===url && !!window.__vtt.board.mapSprite,available);
  const repaired=await page.evaluate(() => {
    const c=window.__vtt.client;
    return c.backend.get('tables/'+c.tableId+'/scenes/'+c.scene.id);
  });
  assert.deepEqual(repaired,{...before,meta:{...before.meta,mapUrl:available}});
  assert.equal(uploads,2);
  assert.equal(await page.getByText('Repair missing artwork',{exact:true}).count(),0);
  console.log('Manual and player-reported automatic recovery each uploaded once. Every other scene field matched.');
} finally { await browser.close(); }
