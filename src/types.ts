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

export interface GridSettings {
  /** world pixels per square */
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
  bg: string;
  grid: GridSettings;
  fog: FogSettings;
  createdAt: number;
}

export type TokenShape = 'circle' | 'square' | 'none';
export type LabelMode = 'all' | 'dm' | 'none';

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
  ownerUid: string | null;
  /** DM-only token (stored in the DM-only subtree, invisible to players) */
  hidden: boolean;
  locked: boolean;
  z: number;
  label: LabelMode;
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
