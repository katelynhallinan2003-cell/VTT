// Evaluates database.rules.json against realistic data with a small interpreter for the
// rules language (child/val/exists/parent, wildcards, cascading read/write, validate).
// It is not Firebase's own engine, but it exercises the rule *logic* we wrote.
import { describe, expect, it } from 'vitest';
import rules from '../database.rules.json';

type Auth = null | { uid: string; token: { email?: string; email_verified?: boolean } };
const OBJ = Symbol('object');

class Snap {
  constructor(private root: any, private path: string[]) {}
  private get v(): any {
    let cur = this.root;
    for (const k of this.path) { if (cur === null || typeof cur !== 'object') return null; cur = cur[k]; }
    return cur ?? null;
  }
  exists() { return this.v !== null; }
  val() { const v = this.v; return v !== null && typeof v === 'object' ? OBJ : v; }
  child(p: string) { return new Snap(this.root, [...this.path, ...p.split('/').filter(Boolean)]); }
  parent() { return new Snap(this.root, this.path.slice(0, -1)); }
  hasChild(p: string) { return this.child(p).exists(); }
  hasChildren(keys?: string[]) {
    const v = this.v;
    if (v === null || typeof v !== 'object') return false;
    return keys ? keys.every((k) => v[k] !== undefined && v[k] !== null) : Object.keys(v).length > 0;
  }
  isString() { return typeof this.v === 'string'; }
}

const clone = (x: any) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
function applyWrite(root: any, path: string[], value: any) {
  const out = clone(root) ?? {};
  if (path.length === 0) return value;
  let cur = out;
  for (let i = 0; i < path.length - 1; i++) { cur[path[i]] ??= {}; cur = cur[path[i]]; }
  if (value === null) delete cur[path[path.length - 1]]; else cur[path[path.length - 1]] = clone(value);
  return out;
}
function prune(v: any): any {
  if (v === null || typeof v !== 'object') return v;
  for (const k of Object.keys(v)) { v[k] = prune(v[k]); if (v[k] === undefined || v[k] === null || (typeof v[k] === 'object' && !Object.keys(v[k]).length)) delete v[k]; }
  return v;
}

function evalExpr(expr: string, ctx: { auth: Auth; data: Snap; newData: Snap; root: Snap; vars: Record<string, string> }): boolean {
  const js = expr.replace(/\.replace\(/g, '.replaceAll(');
  const names = Object.keys(ctx.vars);
  try {
    const fn = new Function('auth', 'data', 'newData', 'root', ...names, `return (${js});`);
    return fn(ctx.auth, ctx.data, ctx.newData, ctx.root, ...names.map((n) => ctx.vars[n])) === true;
  } catch { return false; }
}

interface Step { node: any; keys: string[]; vars: Record<string, string> }
function chain(path: string[]): Step[] {
  const steps: Step[] = [{ node: (rules as any).rules, keys: [], vars: {} }];
  let cur = (rules as any).rules;
  let vars: Record<string, string> = {};
  for (let i = 0; i < path.length; i++) {
    const k = path[i];
    let next = cur[k];
    if (next === undefined) {
      const w = Object.keys(cur).find((x) => x.startsWith('$'));
      if (w) { next = cur[w]; vars = { ...vars, [w]: k }; }
    }
    if (next === undefined || typeof next !== 'object') break;
    steps.push({ node: next, keys: path.slice(0, i + 1), vars });
    cur = next;
  }
  return steps;
}

function can(db: any, auth: Auth, op: 'read' | 'write', pathStr: string, value: any = null): boolean {
  const path = pathStr.split('/').filter(Boolean);
  const newDb = op === 'write' ? prune(applyWrite(db, path, value)) : db;
  const steps = chain(path);
  let granted = false;
  for (const s of steps) {
    const expr = s.node[`.${op}`];
    if (typeof expr !== 'string') continue;
    if (evalExpr(expr, { auth, data: new Snap(db, s.keys), newData: new Snap(newDb, s.keys), root: new Snap(db, []), vars: s.vars })) { granted = true; break; }
  }
  if (!granted) return false;
  if (op === 'write' && value !== null) return validate(db, newDb, auth, path, steps[steps.length - 1], steps.length - 1 === path.length ? steps[steps.length - 1].vars : steps[steps.length - 1].vars, path);
  return true;
}

function validate(db: any, newDb: any, auth: Auth, path: string[], last: Step, vars: Record<string, string>, keys: string[]): boolean {
  // Only the written node and its descendants are validated, and only if the rule chain reaches them.
  if (last.keys.length !== path.length) return true;
  const walk = (node: any, k: string[], v: Record<string, string>): boolean => {
    const snap = new Snap(newDb, k);
    if (!snap.exists()) return true;
    const expr = node['.validate'];
    if (typeof expr === 'string' && !evalExpr(expr, { auth, data: new Snap(db, k), newData: snap, root: new Snap(db, []), vars: v })) return false;
    const val = new Snap(newDb, k) as any;
    const raw = (() => { let cur = newDb; for (const x of k) cur = cur?.[x]; return cur; })();
    if (raw && typeof raw === 'object') {
      for (const child of Object.keys(raw)) {
        let sub = node[child];
        let vv = v;
        if (sub === undefined) { const w = Object.keys(node).find((x) => x.startsWith('$')); if (w) { sub = node[w]; vv = { ...v, [w]: child }; } }
        if (sub && typeof sub === 'object' && !walk(sub, [...k, child], vv)) return false;
      }
    }
    void val;
    return true;
  };
  return walk(last.node, keys, vars);
}

// ---------------------------------------------------------------- fixture
const allTrue = { playersMoveAnyToken: true, playersCreateTokens: true, playersDeleteAnyToken: true, playersPing: true, playersDraw: true, playersMeasure: true };
const T = 'tables/T1';
function makeDb(perm: Record<string, boolean> = allTrue) {
  return {
    config: { allowedEmails: { 'dm@gmail,com': true } },
    tables: {
      T1: {
        owner: 'dm-uid',
        meta: { name: 'Table', activeScene: 'S1' },
        settings: { perm },
        upload: { key: 'k' },
        players: { p1: { name: 'Aria' } },
        scenes: {
          S1: {
            meta: { name: 'Live' },
            tokens: {
              free: { x: 1, y: 1 },
              mine: { x: 1, y: 1, ownerUid: 'p1' },
              theirs: { x: 1, y: 1, ownerUid: 'p2' },
              locked: { x: 1, y: 1, ownerUid: 'p1', locked: true },
            },
            fogOps: { a: { m: 'r', t: 'rect', p: '0,0,1,1' } },
          },
          S2: { meta: { name: 'Prep' } },
        },
        dm: { sceneIndex: { S1: { name: 'Live', order: 1 } }, scenes: { S1: { tokens: { secret: { x: 5 } } } } },
      },
    },
    users: { 'dm-uid': { tables: { T1: { name: 'Table' } } }, other: {} },
  };
}
const dm: Auth = { uid: 'dm-uid', token: { email: 'DM@gmail.com', email_verified: true } };
const p1: Auth = { uid: 'p1', token: {} };
const p2: Auth = { uid: 'p2', token: {} };
const stranger: Auth = { uid: 'g1', token: { email: 'rando@gmail.com', email_verified: true } };

describe('security rules: access', () => {
  const db = makeDb();
  it('nobody can list tables or the allowlist', () => {
    expect(can(db, p1, 'read', 'tables')).toBe(false);
    expect(can(db, dm, 'read', 'config/allowedEmails')).toBe(false);
    expect(can(db, null, 'read', `${T}/meta`)).toBe(false);
  });
  it('you can read only your own allowlist entry', () => {
    expect(can(db, dm, 'read', 'config/allowedEmails/dm@gmail,com')).toBe(true);
    expect(can(db, stranger, 'read', 'config/allowedEmails/dm@gmail,com')).toBe(false);
    expect(can(db, stranger, 'read', 'config/allowedEmails/rando@gmail,com')).toBe(true);
  });
  it('anyone signed in can read table basics and the live scene', () => {
    expect(can(db, p1, 'read', `${T}/meta`)).toBe(true);
    expect(can(db, p1, 'read', `${T}/players`)).toBe(true);
    expect(can(db, p1, 'read', `${T}/scenes/S1`)).toBe(true);
    expect(can(db, p1, 'read', `${T}/upload/key`)).toBe(true);
  });
  it('players cannot read scenes that are not live, or any DM-only data', () => {
    expect(can(db, p1, 'read', `${T}/scenes/S2`)).toBe(false);
    expect(can(db, p1, 'read', `${T}/dm`)).toBe(false);
    expect(can(db, p1, 'read', `${T}/dm/scenes/S1/tokens`)).toBe(false);
    expect(can(db, p1, 'read', `${T}/scenes`)).toBe(false);
  });
  it('the DM reads everything of their table', () => {
    expect(can(db, dm, 'read', `${T}/scenes/S2`)).toBe(true);
    expect(can(db, dm, 'read', `${T}/dm`)).toBe(true);
  });
  it('library data is private to its owner', () => {
    expect(can(db, dm, 'read', 'users/dm-uid/library')).toBe(true);
    expect(can(db, p1, 'read', 'users/dm-uid/library')).toBe(false);
  });
});

describe('security rules: tables and DM powers', () => {
  const db = makeDb();
  it('only allowlisted, verified Google accounts can claim a table', () => {
    const empty = { config: db.config, tables: {} };
    expect(can(empty, dm, 'write', 'tables/NEW/owner', 'dm-uid')).toBe(true);
    expect(can(empty, stranger, 'write', 'tables/NEW/owner', 'g1')).toBe(false);
    expect(can(empty, p1, 'write', 'tables/NEW/owner', 'p1')).toBe(false);
    expect(can(empty, { uid: 'dm-uid', token: { email: 'dm@gmail.com', email_verified: false } }, 'write', 'tables/NEW/owner', 'dm-uid')).toBe(false);
  });
  it('an existing table cannot be taken over', () => {
    expect(can(db, dm, 'write', `${T}/owner`, 'dm-uid')).toBe(false);
    expect(can(db, stranger, 'write', `${T}/owner`, 'g1')).toBe(false);
  });
  it('the owner writes meta, settings, scenes and DM data; players cannot', () => {
    for (const p of [`${T}/meta/activeScene`, `${T}/settings/perm`, `${T}/scenes/S1/meta/grid`, `${T}/scenes/S1/fogOps/b`, `${T}/dm/scenes/S1/tokens/x`, `${T}/upload/key`]) {
      expect(can(db, dm, 'write', p, { a: 1 })).toBe(true);
      expect(can(db, p1, 'write', p, { a: 1 })).toBe(false);
    }
  });
  it('a DM can only write their own library', () => {
    expect(can(db, dm, 'write', 'users/dm-uid/library/maps/x', { url: 'u' })).toBe(true);
    expect(can(db, dm, 'write', 'users/other/library/maps/x', { url: 'u' })).toBe(false);
    expect(can(db, stranger, 'write', 'users/g1/library/maps/x', { url: 'u' })).toBe(false);
  });
});

describe('security rules: tokens with permissive settings', () => {
  const db = makeDb();
  it('players create tokens they own, but not for someone else', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/new`, { x: 1, y: 1, ownerUid: 'p1' })).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/new`, { x: 1, y: 1, ownerUid: 'p2' })).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/new`, { x: 1, y: 1 })).toBe(false);
  });
  it('trusting: players move any unlocked token but never a locked one', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/theirs/x`, 50)).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/free/y`, 50)).toBe(true);
    expect(can(db, p2, 'write', `${T}/scenes/S1/tokens/locked/x`, 50)).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/locked/x`, 50)).toBe(false);
  });
  it('players cannot steal a token someone else controls', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/theirs/ownerUid`, 'p1')).toBe(false);
  });
  it('players cannot touch the DM-only subtree or other scenes', () => {
    expect(can(db, p1, 'write', `${T}/dm/scenes/S1/tokens/secret/x`, 1)).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S2/tokens/x`, { x: 1, ownerUid: 'p1' })).toBe(false);
  });
  it('players ping as themselves only', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/pings/a`, { x: 1, y: 2, uid: 'p1' })).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/pings/a`, { x: 1, y: 2, uid: 'p2' })).toBe(false);
  });
  it('players write their own presence record only', () => {
    expect(can(db, p1, 'write', `${T}/players/p1/online`, true)).toBe(true);
    expect(can(db, p1, 'write', `${T}/players/p2/online`, true)).toBe(false);
  });
});

describe('security rules: tokens with the standard preset', () => {
  const db = makeDb({ ...allTrue, playersMoveAnyToken: false, playersDeleteAnyToken: false });
  it('players move only their own token', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/mine/x`, 9)).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/theirs/x`, 9)).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/free/x`, 9)).toBe(false);
  });
  it('players can claim an unclaimed token for themselves', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/free/ownerUid`, 'p1')).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/free/ownerUid`, 'p2')).toBe(false);
  });
  it('delete is limited to own tokens', () => {
    expect(can(db, p2, 'write', `${T}/scenes/S1/tokens/theirs`, null)).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/theirs`, null)).toBe(false);
  });
  it('the DM can still do anything, including reassigning tokens', () => {
    expect(can(db, dm, 'write', `${T}/scenes/S1/tokens/theirs/ownerUid`, 'p1')).toBe(true);
    expect(can(db, dm, 'write', `${T}/scenes/S1/tokens/locked/x`, 5)).toBe(true);
  });
});

describe('security rules: strict preset', () => {
  const db = makeDb({ playersMoveAnyToken: false, playersCreateTokens: false, playersDeleteAnyToken: false, playersPing: false, playersDraw: false, playersMeasure: true });
  it('blocks creating tokens and pinging', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/new`, { x: 1, ownerUid: 'p1' })).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/pings/a`, { x: 1, y: 2, uid: 'p1' })).toBe(false);
  });
  it('still lets players move their assigned token', () => {
    expect(can(db, p1, 'write', `${T}/scenes/S1/tokens/mine/x`, 9)).toBe(true);
  });
});

describe('security rules: drawings and live plotting', () => {
  const draw = { uid: 'p1', k: 'pen', p: '0,0,10,10' };
  const withDraw = () => {
    const db: any = makeDb();
    db.tables.T1.scenes.S1.draw = { mine: { ...draw }, theirs: { ...draw, uid: 'p2' } };
    return db;
  };
  it('players with the draw permission add drawings as themselves, and only edit or remove their own', () => {
    const db = withDraw();
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/new`, draw)).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/new`, { ...draw, uid: 'p2' })).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/mine`, { ...draw, p: '1,1,2,2' })).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/mine`, null)).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/theirs`, { ...draw, uid: 'p2', p: '1,1,2,2' })).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/theirs`, null)).toBe(false);
  });
  it('a player cannot hand their drawing to someone else or make a malformed one', () => {
    const db = withDraw();
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/mine`, { ...draw, uid: 'p2' })).toBe(false);
    expect(can(db, p1, 'write', `${T}/scenes/S1/draw/bad`, { uid: 'p1', k: 'pen' })).toBe(false);
  });
  it('the DM can change and remove anyone\'s drawing', () => {
    const db = withDraw();
    expect(can(db, dm, 'write', `${T}/scenes/S1/draw/theirs`, { ...draw, uid: 'p2', p: '5,5,6,6' })).toBe(true);
    expect(can(db, dm, 'write', `${T}/scenes/S1/draw/theirs`, null)).toBe(true);
  });
  it('drawing is off when the table says so, and not allowed on a scene that is not live', () => {
    const off = withDraw();
    off.tables.T1.settings.perm = { ...allTrue, playersDraw: false };
    expect(can(off, p1, 'write', `${T}/scenes/S1/draw/new`, draw)).toBe(false);
    expect(can(withDraw(), p1, 'write', `${T}/scenes/S2/draw/new`, draw)).toBe(false);
    expect(can(off, dm, 'write', `${T}/scenes/S1/draw/new`, { ...draw, uid: 'dm-uid' })).toBe(true);
  });
  it('everyone writes only their own live plotting entry', () => {
    const db = withDraw();
    expect(can(db, p1, 'write', `${T}/scenes/S1/live/p1`, { ruler: { ax: 0, ay: 0, bx: 5, by: 5 } })).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S1/live/p2`, { ruler: { ax: 0, ay: 0, bx: 5, by: 5 } })).toBe(false);
    expect(can(db, p1, 'read', `${T}/scenes/S1/live`)).toBe(true);
    expect(can(db, p1, 'write', `${T}/scenes/S2/live/p1`, { ruler: { ax: 0, ay: 0, bx: 5, by: 5 } })).toBe(false);
  });
});
