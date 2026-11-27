import { describe, expect, it, vi } from 'vitest';
import type { TableClient } from '../src/state/client';
import { PictureRecovery } from '../src/state/pictureRecovery';
import { fetchPicture, MissingHostedPicture } from '../src/core/hostedPicture';
import { keepPicture, savedPicture } from '../src/core/pictureStore';
import { uploadToImgbb } from '../src/core/imgbb';
import { parseCampaign, planImport } from '../src/core/campaign';

vi.mock('../src/core/hostedPicture', async original => ({...await original<typeof import('../src/core/hostedPicture')>(), fetchPicture: vi.fn() }));
vi.mock('../src/core/pictureStore', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/pictureStore')>(), savedPicture: vi.fn(), keepPicture: vi.fn(),
}));
vi.mock('../src/core/imgbb', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/imgbb')>(), uploadToImgbb: vi.fn(),
}));
vi.mock('../src/core/images', async importOriginal => ({
  ...await importOriginal<typeof import('../src/core/images')>(),
  loadImage: async (blob: Blob) => ({ naturalWidth: blob.size, naturalHeight: 1 }),
  prepareMapImage: async (blob: Blob) => ({ blob }),
}));

const old = 'https://i.ibb.co/Old/map.jpg', next = 'https://i.ibb.co/New/map.jpg';
const pixels = new Blob(['abcd']);
const initial = { meta: { mapUrl: old, mapW: 4, mapH: 1, mapScale: 2, mapX: 34, mapY: 56, gridTried: true,
  maps: { m: { u: old, x: 3, s: 1.3 } }, grid: { cell: 50 }, fog: { on: true } },
  walls: { w: { x: 75 } }, tokens: { t: { img: old, x: 33, y: 10, hp: 3 } }, draw: { a: { text: 'keep' } } };

function setup(cached: boolean) {
  vi.clearAllMocks();
  vi.mocked(savedPicture).mockResolvedValue(cached ? pixels : null);
  vi.mocked(keepPicture).mockResolvedValue();
  vi.mocked(uploadToImgbb).mockResolvedValue({ url: next, thumb: next, w: 4, h: 1 });
  vi.mocked(fetchPicture).mockImplementation(async url => {
    if (url !== next) throw new MissingHostedPicture('missing');
    return { blob: pixels, image: { naturalWidth: 4, naturalHeight: 1 } as HTMLImageElement };
  });
  const tree: any = { tables: { tab: { meta: { activeScene: 's' }, scenes: { s: structuredClone(initial) } } } };
  const get = (path: string) => path.split('/').reduce((v,k) => v?.[k], tree) ?? null;
  const transaction = async (path: string, change: (x: any) => any) => {
    const value = change(get(path));
    if (value === undefined) return;
    const parts = path.split('/'), key = parts.pop()!;
    const target = parts.reduce((v,k) => v[k] ??= {}, tree);
    if (value === null) delete target[key]; else target[key] = value;
  };
  let keys=0;
  const client = { tableId:'tab', uid:'dm', scene:{id:'s'}, isDM:true, uploadKey:'test',
    backend:{get,transaction,newKey:()=>String(++keys),now:Date.now} } as unknown as TableClient;
  return { recovery:new PictureRecovery(client, () => {}), scene:tree.tables.tab.scenes.s, tree,client };
}

describe('repairing an image during play', () => {
  it('repairs a player-reported cached picture once and preserves every other scene field',async () => {
    const {recovery,scene,tree} = setup(true);
    tree.tables.tab.chars={aria:{cleric:{t:{img:old,hp:12}}}};
    const report = { ['a'.repeat(64)]: {url:old,sid:'s',at:Date.now()} };
    recovery.receive('player',report);
    recovery.receive('player2',report);
    await vi.waitFor(() => expect(scene.meta.mapUrl).toBe(next));
    expect(scene).toEqual(JSON.parse(JSON.stringify(initial).replaceAll(old,next)));
    expect(uploadToImgbb).toHaveBeenCalledTimes(1);
    await vi.waitFor(()=>expect(tree.tables.tab.chars.aria.cleric.t).toEqual({img:next,hp:12}));
  });
  it('compares the server value when Firebase initially supplies null',async()=>{
    const {client,recovery,scene}=setup(true);
    const transaction=client.backend.transaction;
    client.backend.transaction=async(path,change)=>{
      if(change(null)!==undefined) await transaction(path,change);
    };
    await recovery.retry('s',old);
    expect(scene).toEqual(JSON.parse(JSON.stringify(initial).replaceAll(old,next)));
  });
  it('offers manual recovery, rejects mismatched dimensions, and keeps concurrent token edits', async () => {
    const {recovery,scene} = setup(false);
    recovery.failed(old);
    await vi.waitFor(() => expect(recovery.pending).toHaveLength(1));
    expect(scene).toEqual(initial);
    await expect(recovery.restore('s',old,new File(['bad'],'map.jpg'))).rejects.toThrow('4 × 1');
    expect(uploadToImgbb).not.toHaveBeenCalled();
    scene.tokens.t.img = 'another';
    await recovery.restore('s',old,new File(['abcd'],'map.jpg'));
    const expected = JSON.parse(JSON.stringify(initial).replaceAll(old,next));
    expected.tokens.t.img = 'another';
    expect(scene).toEqual(expected);
    expect(recovery.pending).toHaveLength(0);
  });
  it('leaves the scene intact after upload verification fails',async () => {
    const {recovery,scene} = setup(false);
    recovery.failed(old);
    await vi.waitFor(() => expect(recovery.pending).toHaveLength(1));
    vi.mocked(fetchPicture).mockResolvedValue({blob:pixels,image:{naturalWidth:2,naturalHeight:1} as HTMLImageElement});
    await expect(recovery.restore('s',old,new File(['abcd'],'map.jpg'))).rejects.toThrow('different dimensions');
    expect(scene).toEqual(initial);
    expect(recovery.pending).toHaveLength(1);
  });
  it('keeps the original URL during a temporary outage and lets the GM retry',async()=>{
    const {scene,recovery}=setup(true);
    vi.mocked(fetchPicture).mockRejectedValueOnce(new TypeError('offline'));
    await recovery.retry('s',old);
    expect(scene.meta.mapUrl).toBe(old);
    expect(uploadToImgbb).not.toHaveBeenCalled();
    expect(recovery.pending[0].reason).toBeTruthy();
    await recovery.retry('s',old);
    expect(scene.meta.mapUrl).toBe(next);
  });
  it('offers the original-file picker when the cached dimensions are wrong',async()=>{
    const {scene,recovery}=setup(true);
    vi.mocked(savedPicture).mockResolvedValue(new Blob(['wrong size']));
    await recovery.retry('s',old);
    expect(recovery.pending[0].reason).toContain('4 × 1');
    expect(uploadToImgbb).not.toHaveBeenCalled();
    await recovery.restore('s',old,new File(['abcd'],'map.jpg'));
    expect(scene.meta.mapUrl).toBe(next);
  });
  it('resolves a twice-repaired URL even before account listeners arrive',async()=>{
    const {scene,tree,recovery}=setup(false);
    const last='https://i.ibb.co/Last/map.jpg';
    const hash=async(url:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url))),n=>n.toString(16).padStart(2,'0')).join('');
    tree.users={dm:{pictureRepairs:{[await hash(old)]:{url:old,upload:{url:next}},[await hash(next)]:{url:next,upload:{url:last}}}}};
    await recovery.retry('s',old);
    expect(scene).toEqual(JSON.parse(JSON.stringify(initial).replaceAll(old,last)));
    expect(uploadToImgbb).not.toHaveBeenCalled();
  });
});

it('parses and plans an import of 500 scenes and 5,000 tokens', () => {
  const tokens = Object.fromEntries(Array.from({length:10},(_,i)=>['t'+i,{name:'Token '+i,img:old,x:i,y:i}]));
  const scenes = Array.from({length:500},(_,i)=>({name:'Scene '+i,pub:{meta:{mapUrl:old},tokens},dm:{}}));
  const result = parseCampaign(JSON.stringify({format:'vtt-campaign',version:1,table:{name:'Large'},scenes}));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  let n=0;
  const plan=planImport(result.file,{tid:'t',uid:'u',newKey:()=>String(++n),now:1,existingNames:[],orderBase:0,hasActive:false});
  expect(plan.sceneIds).toHaveLength(500);
  expect(result.file.scenes.reduce((sum,s)=>sum+Object.keys(s.pub.tokens).length,0)).toBe(5000);
});
