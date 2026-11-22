// A whole campaign in one file: scenes (with everything on them), handouts and, if you like, your map and token library.
// The file is plain JSON. These functions are pure (no database, no browser) so they can be tested on their own.
import { handoutToWire } from './model';
import { P } from '../state/paths';
import { cleanFolderName } from './folders';
import type { Handout } from '../types';

export const CAMPAIGN_FORMAT = 'vtt-campaign';
export const CAMPAIGN_VERSION = 1;
const MAX_SCENES = 200;
const MAX_NODES = 1_500_000;

type Json = any;

export interface CampaignScene {
  name: string;
  /** the name of the folder it was in, if any */
  folder?: string;
  /** whether it was the scene the players were on */
  active: boolean;
  /** what the players could see: scenes/$sid without the live pointers and pings */
  pub: Record<string, Json>;
  /** what only the DM sees: hidden tokens, hit points, initiative */
  dm: Record<string, Json>;
}
export interface CampaignHandout { title: string; text: string; img: string | null; createdAt: number }
export interface CampaignLibraryItem { name: string; url: string; thumb?: string; w?: number; h?: number }
export interface CampaignFile {
  format: typeof CAMPAIGN_FORMAT;
  version: number;
  exportedAt: number;
  table: { name: string; settings?: Record<string, Json> };
  scenes: CampaignScene[];
  handouts: CampaignHandout[];
  library?: { maps: CampaignLibraryItem[]; tokens: CampaignLibraryItem[] };
}

// ---------------------------------------------------------------- making the file
export function buildCampaign(input: {
  name: string;
  settings?: Record<string, Json> | null;
  scenes: { name: string; active: boolean; folder?: string; pub: Json; dm: Json }[];
  handouts: Handout[];
  library?: { maps: CampaignLibraryItem[]; tokens: CampaignLibraryItem[] } | null;
  now: number;
}): CampaignFile {
  const file: CampaignFile = {
    format: CAMPAIGN_FORMAT,
    version: CAMPAIGN_VERSION,
    exportedAt: input.now,
    table: { name: input.name, ...(input.settings ? { settings: clean(input.settings) as Record<string, Json> } : {}) },
    scenes: input.scenes.map((s) => {
      const pub = { ...(s.pub ?? {}) };
      delete pub.live; // where people are looking and pinging right now is not part of the map
      delete pub.pings;
      return { name: s.name, active: s.active, ...(s.folder ? { folder: s.folder } : {}), pub: (clean(pub) ?? {}) as Record<string, Json>, dm: (clean(s.dm ?? {}) ?? {}) as Record<string, Json> };
    }),
    handouts: [...input.handouts]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((h) => ({ title: h.title, text: h.text, img: h.img, createdAt: h.createdAt })),
  };
  if (input.library) file.library = input.library;
  return file;
}

// ---------------------------------------------------------------- reading a file
export type ParsedCampaign = { ok: true; file: CampaignFile } | { ok: false; error: string };

export function parseCampaign(text: string): ParsedCampaign {
  let raw: Json;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: 'That file is not readable. It should be a campaign file saved from here.' }; }
  if (!raw || typeof raw !== 'object' || raw.format !== CAMPAIGN_FORMAT) return { ok: false, error: 'That is not a campaign file from this app.' };
  if (typeof raw.version !== 'number' || raw.version > CAMPAIGN_VERSION) return { ok: false, error: 'That file was saved by a newer version of the app. Update this page (reload it) and try again.' };
  if (!Array.isArray(raw.scenes)) return { ok: false, error: 'That campaign file has no scenes in it.' };
  if (raw.scenes.length > MAX_SCENES) return { ok: false, error: `That campaign file has more than ${MAX_SCENES} scenes.` };
  try {
    const scenes: CampaignScene[] = [];
    for (const s of raw.scenes) {
      if (!s || typeof s !== 'object' || !s.pub || typeof s.pub !== 'object' || !s.pub.meta || typeof s.pub.meta !== 'object') continue; // a scene without its settings cannot be shown
      const pub = clean(s.pub) as Record<string, Json>;
      delete pub.live; delete pub.pings;
      scenes.push({
        name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 120) : (typeof pub.meta?.name === 'string' ? pub.meta.name : 'Scene'),
        active: s.active === true,
        ...(cleanFolderName(s.folder) ? { folder: cleanFolderName(s.folder) } : {}),
        pub,
        dm: s.dm && typeof s.dm === 'object' ? (clean(s.dm) as Record<string, Json>) ?? {} : {},
      });
    }
    const handouts: CampaignHandout[] = [];
    for (const h of Array.isArray(raw.handouts) ? raw.handouts : []) {
      if (!h || typeof h !== 'object') continue;
      handouts.push({
        title: typeof h.title === 'string' ? h.title.slice(0, 120) : '',
        text: typeof h.text === 'string' ? h.text.slice(0, 20000) : '',
        img: typeof h.img === 'string' && h.img ? h.img : null,
        createdAt: typeof h.createdAt === 'number' && Number.isFinite(h.createdAt) ? h.createdAt : 0,
      });
    }
    const lib = (arr: unknown): CampaignLibraryItem[] => (Array.isArray(arr) ? arr : [])
      .filter((x: any) => x && typeof x.url === 'string' && x.url)
      .map((x: any) => ({
        name: typeof x.name === 'string' ? x.name.slice(0, 120) : 'Untitled',
        url: x.url as string,
        ...(typeof x.thumb === 'string' ? { thumb: x.thumb } : {}),
        ...(typeof x.w === 'number' ? { w: x.w } : {}),
        ...(typeof x.h === 'number' ? { h: x.h } : {}),
      }));
    const file: CampaignFile = {
      format: CAMPAIGN_FORMAT,
      version: raw.version,
      exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
      table: {
        name: typeof raw.table?.name === 'string' ? raw.table.name.slice(0, 120) : 'Campaign',
        ...(raw.table?.settings && typeof raw.table.settings === 'object' ? { settings: clean(raw.table.settings) as Record<string, Json> } : {}),
      },
      scenes,
      handouts,
    };
    if (raw.library && typeof raw.library === 'object') file.library = { maps: lib(raw.library.maps), tokens: lib(raw.library.tokens) };
    if (!scenes.length && !handouts.length && !(file.library && (file.library.maps.length || file.library.tokens.length))) {
      return { ok: false, error: 'That campaign file is empty.' };
    }
    return { ok: true, file };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'That campaign file could not be read.' };
  }
}

/** A short description for the confirm step. */
export function describeCampaign(f: CampaignFile): { scenes: string[]; handouts: number; maps: number; tokens: number } {
  return { scenes: f.scenes.map((s) => s.name), handouts: f.handouts.length, maps: f.library?.maps.length ?? 0, tokens: f.library?.tokens.length ?? 0 };
}

// ---------------------------------------------------------------- putting it in a table
export interface ImportOptions {
  tid: string;
  /** who is importing: they become the author of the drawings */
  uid: string;
  newKey: () => string;
  now: number;
  /** names of scenes already in the table, so the new ones can be told apart */
  existingNames: string[];
  /** the highest scene order already in use */
  orderBase: number;
  /** folders already in the table: scenes from the file go into the one with the same name, or into a new one */
  existingFolders?: { id: string; name: string }[];
  /** the highest folder order already in use */
  folderOrderBase?: number;
  /** is any scene active yet? if not, one of the new ones becomes active */
  hasActive: boolean;
}
export interface ImportPlan {
  updates: Record<string, Json>;
  sceneIds: string[];
  activate: string | null;
  handoutIds: string[];
}

/** The database writes for adding a campaign file to a table. Everything gets new ids, nothing existing is touched. */
export function planImport(file: CampaignFile, o: ImportOptions): ImportPlan {
  const updates: Record<string, Json> = {};
  const sceneIds: string[] = [];
  const taken = new Set(o.existingNames.map((n) => n.toLowerCase()));
  const folderIds = new Map<string, string>((o.existingFolders ?? []).map((f) => [f.name.toLowerCase(), f.id]));
  let folderOrder = o.folderOrderBase ?? 0;
  const folderFor = (name: string | undefined): string | null => {
    const n = cleanFolderName(name);
    if (!n) return null;
    let id = folderIds.get(n.toLowerCase());
    if (!id) {
      id = o.newKey();
      folderIds.set(n.toLowerCase(), id);
      folderOrder += 1;
      updates[`${P.sceneFolders(o.tid)}/${id}`] = { name: n, order: folderOrder };
    }
    return id;
  };
  let order = o.orderBase;
  let activate: string | null = null;
  for (const s of file.scenes) {
    const sid = o.newKey();
    sceneIds.push(sid);
    let name = s.name || 'Scene';
    if (taken.has(name.toLowerCase())) {
      let n = 2;
      while (taken.has(`${name} (${n})`.toLowerCase())) n++;
      name = `${name} (${n})`;
    }
    taken.add(name.toLowerCase());
    const pub = structuredClone(s.pub) as Record<string, Json>;
    pub.meta = { ...pub.meta, name };
    // player ids belong to the table the file came from: those tokens and drawings are free to claim here
    for (const t of Object.values((pub.tokens ?? {}) as Record<string, Json>)) if (t && typeof t === 'object') delete t.ownerUid;
    const dm = structuredClone(s.dm) as Record<string, Json>;
    for (const t of Object.values((dm.tokens ?? {}) as Record<string, Json>)) if (t && typeof t === 'object') delete t.ownerUid;
    for (const d of Object.values((pub.draw ?? {}) as Record<string, Json>)) if (d && typeof d === 'object') d.uid = o.uid;
    order += 1;
    updates[P.scene(o.tid, sid)] = pub;
    if (Object.keys(dm).length) updates[P.dmScene(o.tid, sid)] = dm;
    const folder = folderFor(s.folder);
    updates[`${P.sceneIndex(o.tid)}/${sid}`] = { name, order, ...(folder ? { folder } : {}) };
    if (!o.hasActive && !activate && s.active) activate = sid;
  }
  if (!o.hasActive && !activate && sceneIds.length) activate = sceneIds[0];
  const handoutIds: string[] = [];
  for (const h of file.handouts) {
    const id = o.newKey();
    handoutIds.push(id);
    // never shown on arrival: the DM chooses when
    updates[P.dmHandout(o.tid, id)] = handoutToWire({ id, title: h.title || 'Handout', text: h.text, img: h.img, to: null, shown: false, n: 0, createdAt: h.createdAt || o.now });
  }
  return { updates, sceneIds, activate, handoutIds };
}

/** Library items that are not already there (matched by their address). */
export function newLibraryItems(have: { url: string }[], incoming: CampaignLibraryItem[]): CampaignLibraryItem[] {
  const urls = new Set(have.map((h) => h.url));
  const out: CampaignLibraryItem[] = [];
  for (const it of incoming) {
    if (urls.has(it.url)) continue;
    urls.add(it.url);
    out.push(it);
  }
  return out;
}

// ---------------------------------------------------------------- tidying data from a file
const BAD_KEY = /[.$#[\]/\u0000-\u001f\u007f]/;

/** Copies data keeping only what the database can hold: no empty values, no keys with forbidden characters, a sane depth and size. */
export function clean(v: unknown): unknown {
  const budget = { n: 0 };
  const go = (x: unknown, depth: number): unknown => {
    if (++budget.n > MAX_NODES) throw new Error('That campaign file is too large to import.');
    if (x === null || x === undefined) return undefined;
    if (typeof x === 'string') return x.length > 200000 ? x.slice(0, 200000) : x;
    if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
    if (typeof x === 'boolean') return x;
    if (depth > 12) return undefined;
    if (Array.isArray(x)) {
      const arr = x.map((y) => go(y, depth + 1)).filter((y) => y !== undefined);
      return arr.length ? arr : undefined;
    }
    if (typeof x === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, y] of Object.entries(x as Record<string, unknown>)) {
        if (!k || BAD_KEY.test(k) || k.length > 700) continue;
        const c = go(y, depth + 1);
        if (c !== undefined) out[k] = c;
      }
      return Object.keys(out).length ? out : undefined;
    }
    return undefined;
  };
  return go(v, 0);
}
