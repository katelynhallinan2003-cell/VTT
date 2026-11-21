import type { GridCut } from './core/gridcut';
// Shared data model. Everything that crosses the network is plain JSON.
// NOTE: Firebase Realtime Database drops null/undefined/empty values, so every
// reader goes through the normalize*() helpers in core/model.ts to fill defaults.

export interface AuthUser {
  uid: string;
  name: string | null;
  email: string | null;
  photo: string | null;
  anonymous: boolean;
}

export interface Vec { x: number; y: number }
export interface Rect { x: number; y: number; w: number; h: number }

export type Role = 'dm' | 'player';

/** chebyshev = every diagonal is 5 ft (5e default). alt = 5-10-5. euclid = true distance. */
export type DistanceRule = 'chebyshev' | 'alt' | 'euclid';

/** square cells, or hexes with a point at the top ('pointy') or a flat top ('flat') */
export type GridShape = 'square' | 'pointy' | 'flat';

export interface GridSettings {
  shape: GridShape;
  /** world pixels per square (for hexes: between the centres of two neighbouring hexes) */
  cell: number;
  /** world position of a vertical / horizontal grid line */
  ox: number;
  oy: number;
  visible: boolean;
  color: string;
  opacity: number;
  /** feet per square */
  ft: number;
  rule: DistanceRule;
  /** snap tokens to the grid */
  snap: boolean;
}

export interface FogSettings {
  enabled: boolean;
  /** state before any fog operations are applied */
  base: 'hidden' | 'clear';
  /** tokens with a sight distance clear the fog around themselves while they stand there */
  vision: boolean;
  /** the DM's browser keeps the ground those tokens have seen revealed */
  explore: boolean;
}

export interface SceneMeta {
  name: string;
  mapUrl: string | null;
  /** natural pixel size of the map image */
  mapW: number;
  mapH: number;
  mapX: number;
  mapY: number;
  mapScale: number;
  mapLocked: boolean;
  /** a grid printed on the map picture, and whether it is hidden on screen (the picture itself is never changed) */
  mapGrid: GridCut | null;
  bg: string;
  grid: GridSettings;
  fog: FogSettings;
  createdAt: number;
}

export type TokenShape = 'circle' | 'square' | 'none';
export type LabelMode = 'all' | 'dm' | 'none';
/** off = players see nothing, state = bloodied / near death colouring only, bar = that colouring plus a health bar (never the numbers) */
export type HpShow = 'off' | 'state' | 'bar';
export type HealthState = 'ok' | 'bloodied' | 'mortal' | 'down';

export interface Token {
  id: string;
  name: string;
  img: string | null;
  /** center, world pixels */
  x: number;
  y: number;
  /** size in grid squares (0.5 tiny, 1 medium, 2 large ...) */
  size: number;
  shape: TokenShape;
  ring: string;
  /** ring thickness as a fraction of token diameter */
  ringW: number;
  /** image framing inside the token: zoom factor and offset (fraction of diameter) */
  imgScale: number;
  imgX: number;
  imgY: number;
  /** colour filling the token shape behind the picture (visible where the picture does not reach) */
  imgBg: string | null;
  /** coloured areas around the token: auras and emanations */
  auras: Aura[];
  /** hit points. Only the DM ever receives these (they live in the DM-only part of the database). */
  hp: number | null;
  maxHp: number | null;
  /** temporary hit points: soaked up before real ones, never healed, and not counted against the maximum. DM only. */
  tempHp: number;
  /** what players get to see of this token's health */
  hpShow: HpShow;
  /** health as a whole percentage, for players. Written only when `hpShow` is not 'off'. */
  hpPct: number | null;
  /** how far this token can see, in feet (0 = it does not clear fog by itself) */
  sight: number;
  /** off the ground: it holds `elev` feet of altitude instead of standing on whatever height the ground has there */
  fly: boolean;
  /** altitude in feet above the map's base level (only used while `fly` is on) */
  elev: number;
  /** added to a d20 when this token rolls for initiative (remembered per token) */
  initBonus: number;
  /** conditions and other effects on it: poisoned, blessed, a custom one... Everyone who can see the token sees them. */
  fx: Effect[];
  ownerUid: string | null;
  /** DM-only token (stored in the DM-only subtree, invisible to players) */
  hidden: boolean;
  locked: boolean;
  z: number;
  label: LabelMode;
}

/** How an effect shows on its token. */
export type FxLook = 'badge' | 'halo' | 'orbit' | 'dot';
/** When an effect with a duration counts down: at the end of its token's turn, at the start of it, or at the start of every round. */
export type FxTick = 'end' | 'start' | 'round';

/** A condition or other effect on a token (poisoned, blessed, a made-up one). */
export interface Effect {
  id: string;
  /** what it is called */
  n: string;
  /** the picture shown on the token (an emoji or a letter); may be empty */
  ic: string;
  /** colour */
  c: string;
  look: FxLook;
  /** also tint the whole token with a colour wash (on top of whatever look it has) */
  tint: boolean;
  /** the tint colour; empty means the same as `c` */
  tc: string;
  /** rounds left, or null when it lasts until someone removes it */
  left: number | null;
  tick: FxTick;
}

/** An area around a token, measured in feet. */
export interface Aura {
  /** radius in feet */
  r: number;
  color: string;
  /** fill opacity 0..1 */
  a: number;
  shape: 'circle' | 'square';
  /** measured from the edge of the token (5e emanation) instead of its centre */
  edge: boolean;
  /** only the DM sees it */
  dm: boolean;
}

export type DrawKind = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'cone' | 'cube' | 'sphere' | 'emanation' | 'beam' | 'terrain';

/** Something drawn on the map: freehand, a shape, text or a spell template. */
export interface Drawing {
  id: string;
  /** who made it */
  uid: string;
  k: DrawKind;
  /** points as "x,y,x,y,...": every point for pen strokes, start and end for shapes and templates */
  p: string;
  color: string;
  /** stroke width in world pixels */
  w: number;
  /** fill opacity 0..1 (0 = none, 1 = solid) */
  fill: number;
  /** fill colour; empty means the same as the outline colour */
  fc: string;
  dash: boolean;
  /** text content (text only; lines are separated by \n) */
  txt: string;
  /** font size in world pixels (text only) */
  fs: number;
  /** font family key (text only): '' sans, serif, mono, hand, fantasy */
  font: string;
  /** bold, italic, underline (text only) */
  b: boolean;
  i: boolean;
  u: boolean;
  /** no outline around the letters (text only) */
  ho: boolean;
  /** width of a line template, in feet */
  bw: number;
  /** how wide the creature an emanation comes from is, in feet (0 or missing: one square) */
  of?: number;
  /** a box, circle or brush stroke with a height set marks ground at that many feet above (or below) the map's base level */
  hz: number | null;
  /** terrain brush strokes: the area (everything painted together) this stroke belongs to */
  hg?: string;
  /** terrain: the area adds this height to the ground below it, instead of setting it */
  ha?: boolean;
  /** terrain: this stroke takes ground away from its area (or from every area when `hg` is empty) */
  he?: boolean;
  /** terrain: the stroke is a list of whole cells (their centres), not a free brush */
  hc?: boolean;
  t: number;
}

/** What someone is plotting right now (ruler, test moves). Short-lived, only shared when they choose to. */
export interface LivePlot {
  uid: string;
  ruler: { a: Vec; b: Vec; c?: string } | null;
  /** token id -> where they are trying that token out */
  ghosts: Record<string, Vec>;
}

/** One line of the initiative order. */
export interface InitEntry {
  id: string;
  /** the token it stands for (null for things like lair actions) */
  tk: string | null;
  n: string;
  /** the initiative number */
  i: number;
  /** kept secret from players */
  h: boolean;
  /** position in the order (smaller goes first) */
  o: number;
}
/** The DM's full initiative state. */
export interface InitState {
  round: number;
  /** entry whose turn it is */
  turn: string | null;
  /** players can see the order */
  shown: boolean;
  /** in turn order */
  entries: InitEntry[];
}
/** What players are shown once the DM reveals the order: no hidden entries. */
export interface InitPub {
  round: number;
  turn: string | null;
  entries: { id: string; tk: string | null; n: string; i: number; o: number }[];
}

export type FogMode = 'r' | 'h'; // reveal | hide
export type FogOp =
  | { m: FogMode; t: 'rect'; p: string }            // "x,y,w,h"
  | { m: FogMode; t: 'poly'; p: string }            // "x1,y1,x2,y2,..."
  | { m: FogMode; t: 'line'; p: string; w: number }; // polyline + stroke width

export interface Permissions {
  playersMoveAnyToken: boolean;
  playersCreateTokens: boolean;
  playersDeleteAnyToken: boolean;
  playersPing: boolean;
  playersDraw: boolean;
  playersMeasure: boolean;
}
export type PermPreset = 'trusting' | 'standard' | 'strict' | 'custom';

export interface TableMeta {
  name: string;
  activeScene: string | null;
  createdAt: number;
}

export interface TableSettings {
  perm: Permissions;
  preset: PermPreset;
}

export interface Player {
  uid: string;
  name: string;
  color: string;
  online: boolean;
  joinedAt: number;
  /** the table's DM (cosmetic badge only; real DM-ness is enforced by the database rules) */
  dm: boolean;
}

export interface SceneIndexEntry { id: string; name: string; order: number }

export interface Ping { id: string; x: number; y: number; uid: string; color: string; name: string; t: number }

export interface LibraryItem {
  id: string;
  name: string;
  url: string;
  thumb?: string;
  w?: number;
  h?: number;
  addedAt: number;
}

export type LibraryKind = 'maps' | 'tokens';

export interface UserTableEntry { id: string; name: string; createdAt: number }

export interface AppConfig {
  firebase: {
    apiKey: string;
    authDomain: string;
    databaseURL: string;
    projectId: string;
    appId: string;
  } | null;
  demo: boolean;
}
