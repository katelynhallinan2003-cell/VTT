import type { TableClient } from './client';
import { stripUndefined } from '../core/model';
import { loadImage, prepareMapImage } from '../core/images';
import { P } from './paths';
import { hostedPicture, keepPicture, savedPicture } from '../core/pictureStore';
import { fetchPicture, MissingHostedPicture } from '../core/hostedPicture';
import { uploadToImgbb, type UploadResult } from '../core/imgbb';

const validKey = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const idFor = async (url: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url))), b => b.toString(16).padStart(2, '0')).join('');

export function scenePicturePaths(meta: any, tokens: any, url: string, playersOnly: boolean) {
  const paths: string[] = [];
  if (meta?.mapUrl === url) paths.push('meta/mapUrl');
  for (const [id, map] of Object.entries<any>(meta?.maps ?? {})) {
    if (validKey(id) && map?.u === url && (!playersOnly || map.v !== false)) paths.push('meta/maps/' + id + '/u');
  }
  for (const [id, token] of Object.entries<any>(tokens ?? {})) {
    if (validKey(id) && token?.img === url) paths.push('tokens/' + id + '/img');
  }
  return paths;
}

export class PictureRecovery {
  liveOriginal?: (url: string) => Promise<Blob | null>;
  private aliases = new Map<string, string>();

  start() {
    const c = this.client;
    return c.backend.listenChildren(P.user(c.uid) + '/pictureRepairs', {
      added: (_, v) => this.remember(v),
      changed: (_, v) => this.remember(v),
    });
  }

  private remember(v: any) {
    if (!hostedPicture(v?.url) || !hostedPicture(v?.upload?.url) || this.aliases.get(v.url) === v.upload.url) return;
    this.aliases.set(v.url, v.upload.url);
    // Initial listeners and changes from another GM tab can arrive in either order.
    const c = this.client, s = c.scene;
    if (s?.meta) {
      const meta = P.sceneMeta(c.tableId,s.id);
      this.refresh(meta+'/mapUrl',s.meta.mapUrl);
      for (const map of s.meta.maps) this.refresh(meta+'/maps/'+map.id+'/u',map.url);
      for (const token of s.tokens.values()) this.refresh((token.hidden ? P.dmSceneToken : P.sceneToken)(c.tableId,s.id,token.id)+'/img',token.img);
    }
    for (const [id,h] of c.handouts ?? []) {
      this.refresh(P.dmHandout(c.tableId,id)+'/img',h.img);
      if (h.shown) this.refresh(P.handout(c.tableId,id)+'/img',h.img);
    }
  }

  current(url: string) {
    const seen = new Set<string>();
    while (this.aliases.has(url) && !seen.has(url)) {
      seen.add(url);
      url = this.aliases.get(url)!;
    }
    return url;
  }

  refresh(path: string, url: unknown) {
    if (!this.client.isDM || typeof url !== 'string') return;
    const next = this.current(url);
    if (url !== next) void this.replace(path,url,next).catch(console.warn);
  }

  private replace(path:string, old:string, next:string) {
    // Firebase can call the updater with null before it knows the server value.
    // Returning null in that case lets it compare and retry at the server.
    return this.client.backend.transaction(path, v => v == null ? null : v === old ? next : undefined);
  }

  private uploads = new Map<string,Promise<UploadResult>>();
  private jobs = new Map<string, Promise<void>>();
  private readonly waiting:(()=>void)[]=[];
  private running=0;
  private readonly reports=new Set<string>();
  pending: { sid: string; url: string; name: string; w: number; h: number; reason?:string }[] = [];
  private closed = false;
  constructor(private client: TableClient, private changed: () => void) {}

  stop() { this.closed = true; }

  dismiss(sid: string, url: string) {
    this.pending = this.pending.filter(p => p.sid !== sid || p.url !== url);
    this.changed();
  }

  async restore(sid: string, url: string, file: File) {
    if (!this.client.isDM || !this.pending.some(p => p.sid === sid && p.url === url)) return;
    await this.repair(sid, url, undefined, file);
    this.dismiss(sid, url);
  }

  failed(url: string) {
    const c = this.client, sid = c.scene?.id;
    if (!sid || !hostedPicture(url)) return;
    void this.report(sid, url).catch(console.warn);
  }

  private async report(sid: string, url: string) {
    const c = this.client;
    if (c.isDM) return this.run(sid, url);
    const key = await idFor(url);
    const path = P.player(c.tableId, c.uid) + '/pictureRequests/' + key;
    await c.backend.set(path, { sid, url, at: c.backend.now() });
  }

  receive(uid: string, requests: any) {
    const c = this.client;
    if (!c.isDM || !validKey(uid)) return;
    for (const [key, r] of Object.entries<any>(requests ?? {}).slice(-64)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !validKey(r?.sid) || !hostedPicture(r.url) || !Number.isFinite(r.at)) continue;
      const path = P.player(c.tableId, uid) + '/pictureRequests/' + key;
      const request=JSON.stringify([path,r.at]);
      if(this.reports.has(request)) continue;
      const finish = () => c.backend.transaction(path, v => v == null || (v.at === r.at && v.url === r.url) ? null : undefined);
      if (c.backend.now() - r.at > 86400000) { void finish().catch(console.warn); continue; }
      this.reports.add(request);
      void this.run(r.sid, r.url, uid).then(finish).catch(console.warn).finally(()=>this.reports.delete(request));
    }
  }

  private run(sid: string, url: string, requester?:string) {
    const key = JSON.stringify([sid, url, requester]);
    let job = this.jobs.get(key);
    if (!job) {
      job = this.withSlot(()=>this.repair(sid, url, requester)).finally(() => this.jobs.delete(key));
      this.jobs.set(key, job);
    }
    return job;
  }

  private async withSlot(work:()=>Promise<void>) {
    if(this.running<3) this.running++;
    else await new Promise<void>(resolve=>this.waiting.push(resolve));
    try { if(!this.closed) await work(); }
    finally {
      const next=this.waiting.shift();
      if(next) next(); else this.running--;
    }
  }

  async retry(sid:string, url:string) {
    if (this.client.isDM) await this.run(sid,url);
  }

  private async publish(record:string,url:string,original:Blob,w:number,h:number):Promise<UploadResult> {
    const db=this.client.backend;
    const apiKey=this.client.uploadKey ?? await db.get(P.uploadKey(this.client.tableId));
    if (!apiKey) throw new Error('Add the ImgBB key under Settings → Pictures and files.');
    const lock=db.newKey(), lease=120000;
    while (!this.closed) {
      const now=db.now();
      await db.transaction(record,v=>v?.upload || v?.until>now ? undefined : {lock,until:now+lease});
      const claimed=await db.get(record);
      if(claimed?.upload) return claimed.upload;
      if(claimed?.lock===lock) break;
      await new Promise(resolve=>setTimeout(resolve,1500));
    }
    if(this.closed) throw new Error('The table has closed.');
    const renew=setInterval(()=>void db.transaction(record,v=>v==null ? null : v.lock===lock ? {lock,until:db.now()+lease} : undefined).catch(console.warn),lease/3);
    try {
      const upload=await uploadToImgbb(original,apiKey,url.split('/').pop());
      if(!hostedPicture(upload.url) || upload.url===url) throw new Error('The host did not provide a new picture link.');
      const restored=await verifyUpload(upload.url);
      if(restored.image.naturalWidth!==w || restored.image.naturalHeight!==h) throw new Error('The replacement has different dimensions.');
      await keepPicture(upload.url,original);
      await db.transaction(record,v=>v==null ? null : v.lock===lock ? {url,upload:stripUndefined({...upload})} : undefined);
      const committed=await db.get(record);
      if(!committed?.upload) throw new Error('Could not save the verified replacement. Retry recovery.');
      return committed.upload;
    } finally {
      clearInterval(renew);
      await db.transaction(record,v=>v==null || v.lock===lock ? null : undefined);
    }
  }

  private async repair(sid: string, url: string, requester?:string, file?: File) {
    const c = this.client, db = c.backend;
    const playersOnly = requester !== undefined;
    if (this.closed || (playersOnly && sid !== await db.get(P.activeScene(c.tableId)))) return;
    const root = P.scene(c.tableId, sid), hidden = P.dmScene(c.tableId, sid);
    const [meta, tokens, hiddenTokens] = await Promise.all([db.get(root + '/meta'), db.get(root + '/tokens'), playersOnly ? null : db.get(hidden + '/tokens')]);
    const paths = scenePicturePaths(meta, tokens, url, playersOnly).map(p => root + '/' + p);
    paths.push(...scenePicturePaths(null, hiddenTokens, url, false).map(p => hidden + '/' + p));
    for (const [id, h] of c.handouts ?? []) {
      if (h.img !== url || (requester && (!h.shown || (h.to && !h.to.includes(requester))))) continue;
      paths.push(P.dmHandout(c.tableId, id) + '/img');
      if (h.shown) paths.push(P.handout(c.tableId, id) + '/img');
    }
    if (!paths.length) { if (!playersOnly) this.dismiss(sid,url); return; }
    const key = await idFor(url), record = P.user(c.uid) + '/pictureRepairs/' + key;
    const previous = await db.get(record);
    let result: UploadResult | undefined = previous?.upload;
    const map = Object.values<any>(meta?.maps ?? {}).find(m => m?.u === url);
    const w = meta?.mapUrl === url ? meta.mapW : map?.w;
    const h = meta?.mapUrl === url ? meta.mapH : map?.h;
    const ask = (reason?:string) => {
      if(this.closed) return;
      const item={sid,url,name:meta?.name ?? 'Scene',w:w ?? 0,h:h ?? 0,reason};
      const index=this.pending.findIndex(p=>p.sid===sid && p.url===url);
      if(index<0) this.pending.push(item); else this.pending[index]=item;
      this.changed();
    };
    if (!result) {
      // Retrieve cached bytes before probing the network. Refreshing a missing
      // URL can replace a previously good entry in the browser's HTTP cache.
      let original = file ? (await prepareMapImage(file)).blob : await savedPicture(url);
      if (!original) original = (await fetchPicture(url, 'force-cache').catch(() => null))?.blob ?? null;
      if (!original) original = await this.liveOriginal?.(url).catch(()=>null) ?? null;
      if (this.closed) return;
      if (!file) {
        try {
          const fresh=await fetchPicture(url,'no-store');
          await keepPicture(url,fresh.blob);
          this.dismiss(sid,url);
          return;
        } catch(error) {
          if (!(error instanceof MissingHostedPicture)) {
            ask('The image host could not be verified. Retry when the connection is available, or choose the original to replace the link.');
            return;
          }
        }
      }
      if (!original) { ask(); return; }
      try {
        const source=await loadImage(original);
        if(w && h && (source.naturalWidth!==w || source.naturalHeight!==h)) {
          throw new Error(`Choose the original map at ${w} × ${h} pixels. This image is ${source.naturalWidth} × ${source.naturalHeight}.`);
        }
        let publishing=this.uploads.get(url);
        if(!publishing) {
          publishing=this.publish(record,url,original,source.naturalWidth,source.naturalHeight).finally(()=>this.uploads.delete(url));
          this.uploads.set(url,publishing);
        }
        result=await publishing;
      } catch(error) {
        if(file) throw error;
        ask(error instanceof Error ? error.message : 'Automatic recovery failed.');
        return;
      }
    }
    if (!result || this.closed) return;
    // A replacement can go missing in turn. Resolve the durable chain even
    // when this tab has not received its initial alias events yet.
    const seen=new Set([url]);
    while (hostedPicture(result.url) && !seen.has(result.url)) {
      seen.add(result.url);
      const successor=await db.get(P.user(c.uid)+'/pictureRepairs/'+await idFor(result.url));
      if(!successor?.upload) break;
      result=successor.upload as UploadResult;
      if(seen.has(result.url)) throw new Error('Circular picture repair history.');
    }
    if(!hostedPicture(result.url) || result.url===url) throw new Error('Invalid replacement picture.');
    const replacement = result;
    this.aliases.set(url,replacement.url);
    for (let i = 0; i < paths.length; i += 24) {
      await Promise.all(paths.slice(i, i + 24).map(path => this.replace(path,url,replacement.url)));
    }
    for (const kind of ['maps', 'tokens']) {
      const lib = P.userLibrary(c.uid, kind);
      const rows = await db.get(lib);
      for (const [id, row] of Object.entries<any>(rows ?? {})) {
        if (row?.url !== url || !validKey(id)) continue;
        await db.transaction(lib + '/' + id, v => v == null ? null : v.url === url ? { ...v, url: replacement.url, thumb: replacement.thumb, preview: replacement.preview ?? replacement.url, deleteUrl: replacement.deleteUrl ?? null } : undefined);
      }
    }
    // A saved character may never be on the board while the repair runs.
    const templates=P.userTokenLib(c.uid), characters=P.table(c.tableId)+'/chars';
    const [dmTokens,players]=await Promise.all([db.get(templates),db.get(characters)]);
    const savedPaths:string[]=[];
    const collect=(base:string,rows:unknown)=>{
      for(const [id,row] of Object.entries<any>(rows ?? {})) {
        if(validKey(id) && row?.t?.img===url) savedPaths.push(base+'/'+id+'/t/img');
      }
    };
    collect(templates,dmTokens);
    for(const [rid,rows] of Object.entries(players ?? {})) if(validKey(rid)) collect(characters+'/'+rid,rows);
    for(let i=0;i<savedPaths.length;i+=24)
      await Promise.all(savedPaths.slice(i,i+24).map(path=>this.replace(path,url,replacement.url)));
    this.dismiss(sid, url);
  }
}

async function verifyUpload(url: string) {
  for (const delay of [0, 1200, 3000]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try { return await fetchPicture(url, 'no-store'); } catch (error) { if (delay === 3000) throw error; }
  }
  throw new Error('Could not verify the restored image');
}
