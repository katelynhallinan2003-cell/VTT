import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInAnonymously, signInWithPopup, signOut as fbSignOut,
  type Auth, type User,
} from 'firebase/auth';
import {
  getDatabase, get as dbGet, onChildAdded, onChildChanged, onChildRemoved, onDisconnect, onValue,
  push, ref, runTransaction, remove as dbRemove, set as dbSet, update as dbUpdate, type Database,
} from 'firebase/database';
import type { AppConfig, AuthUser } from '../types';
import type { Backend, ChildHandlers, Unsub } from './types';

const toUser = (u: User | null): AuthUser | null =>
  u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL, anonymous: u.isAnonymous } : null;

export class FirebaseBackend implements Backend {
  readonly kind = 'firebase' as const;
  private app: FirebaseApp;
  private auth: Auth;
  private db: Database;
  private offset = 0;
  private authReady: Promise<void>;

  constructor(cfg: NonNullable<AppConfig['firebase']>) {
    this.app = initializeApp(cfg);
    this.auth = getAuth(this.app);
    this.db = getDatabase(this.app);
    this.authReady = new Promise((resolve) => {
      const off = onAuthStateChanged(this.auth, () => { off(); resolve(); });
    });
    onValue(ref(this.db, '.info/serverTimeOffset'), (s) => { this.offset = Number(s.val()) || 0; });
  }

  ready() { return this.authReady; }
  now() { return Date.now() + this.offset; }

  currentUser() { return toUser(this.auth.currentUser); }
  onAuth(cb: (u: AuthUser | null) => void): Unsub {
    return onAuthStateChanged(this.auth, (u) => cb(toUser(u)));
  }
  async signInGoogle() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const res = await signInWithPopup(this.auth, provider);
    return toUser(res.user)!;
  }
  async signInAnon() {
    const res = await signInAnonymously(this.auth);
    return toUser(res.user)!;
  }
  async signOut() { await fbSignOut(this.auth); }

  async get(path: string) { return (await dbGet(ref(this.db, path))).val(); }
  async set(path: string, value: any) { await dbSet(ref(this.db, path), value); }
  async remove(path: string) { await dbRemove(ref(this.db, path)); }
  async update(updates: Record<string, any>) { await dbUpdate(ref(this.db), updates); }
  async transaction(path: string, change: (value: any) => any) {
    await runTransaction(ref(this.db,path),change,{applyLocally:false});
  }
  newKey() { return push(ref(this.db, 'keys')).key!; }

  listen(path: string, cb: (v: any) => void, onError?: (e: Error) => void): Unsub {
    return onValue(ref(this.db, path), (s) => cb(s.val()), (e) => onError?.(e));
  }

  listenChildren(path: string, h: ChildHandlers, onError?: (e: Error) => void): Unsub {
    const r = ref(this.db, path);
    const err = (e: Error) => onError?.(e);
    const offs = [
      onChildAdded(r, (s) => h.added?.(s.key!, s.val()), err),
      onChildChanged(r, (s) => h.changed?.(s.key!, s.val()), err),
      onChildRemoved(r, (s) => h.removed?.(s.key!, s.val()), err),
    ];
    return () => offs.forEach((o) => o());
  }

  onDisconnectSet(path: string, value: any) {
    void onDisconnect(ref(this.db, path)).set(value);
  }
}
