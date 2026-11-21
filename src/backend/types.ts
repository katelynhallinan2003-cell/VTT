import type { AuthUser } from '../types';

export type Unsub = () => void;

export interface ChildHandlers {
  added?: (key: string, value: any) => void;
  changed?: (key: string, value: any) => void;
  removed?: (key: string, value: any) => void;
}

/** Value that the database replaces with its own clock when written. */
export const SERVER_TS = { '.sv': 'timestamp' } as const;

/**
 * A thin, Realtime-Database-shaped interface. Two implementations exist:
 *  - FirebaseBackend (production)
 *  - MockBackend (local demo + automated tests; works across browser tabs)
 * Both fire local listeners synchronously on write (latency compensation), like Firebase does.
 */
export interface Backend {
  readonly kind: 'firebase' | 'mock';
  ready(): Promise<void>;

  currentUser(): AuthUser | null;
  onAuth(cb: (u: AuthUser | null) => void): Unsub;
  signInGoogle(): Promise<AuthUser>;
  signInAnon(): Promise<AuthUser>;
  signOut(): Promise<void>;

  get(path: string): Promise<any | null>;
  set(path: string, value: any): Promise<void>;
  /** Multi-path update from the database root. A null value deletes that path. Atomic. */
  update(updates: Record<string, any>): Promise<void>;
  remove(path: string): Promise<void>;
  /** A new time-sortable child key (does not write anything). */
  newKey(): string;

  listen(path: string, cb: (value: any | null) => void, onError?: (e: Error) => void): Unsub;
  listenChildren(path: string, handlers: ChildHandlers, onError?: (e: Error) => void): Unsub;

  /** Best-effort: write `value` at `path` when this client disconnects. */
  onDisconnectSet(path: string, value: any): void;
  /** Server-adjusted current time in ms. */
  now(): number;
}
