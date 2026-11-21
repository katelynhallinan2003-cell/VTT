import { useEffect, useMemo, useState } from 'preact/hooks';
import { createBackend, loadConfig } from '../backend';
import type { Backend } from '../backend/types';
import { PLAYER_COLORS } from '../core/model';
import { createTable, getTableName, getTableOwner, isAllowedDM, watchUserTables } from '../state/account';
import { TableClient } from '../state/client';
import { P } from '../state/paths';
import type { AppConfig, AuthUser, UserTableEntry } from '../types';
import { Toasts, copyText, toast, useRerender } from './common';
import { TableView } from './TableView';

const asErr = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useHashRoute(): { tid: string | null } {
  const parse = () => { const m = location.hash.match(/^#\/t\/([A-Za-z0-9_-]+)/); return { tid: m ? m[1] : null }; };
  const [r, setR] = useState(parse);
  useEffect(() => { const h = () => setR(parse()); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, []);
  return r;
}

export function App() {
  const [boot, setBoot] = useState<{ backend: Backend; config: AppConfig } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      const backend = await createBackend(config);
      await backend.ready();
      setBoot({ backend, config });
    })().catch((e) => setErr(asErr(e)));
  }, []);

  if (err) return <div class="screen center"><div class="card"><h1>Something went wrong</h1><p class="error-text">{err}</p></div></div>;
  if (!boot) return <div class="screen center"><div class="splash">Loading…</div></div>;
  return route.tid
    ? <TableScreen key={route.tid} tid={route.tid} backend={boot.backend} demo={boot.config.demo} />
    : <Home backend={boot.backend} demo={boot.config.demo} />;
}

// ====================================================================== home / DM login
function Home(props: { backend: Backend; demo: boolean }) {
  const { backend } = props;
  const [user, setUser] = useState<AuthUser | null>(backend.currentUser());
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tables, setTables] = useState<UserTableEntry[]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const isDmUser = !!user && !user.anonymous;

  useEffect(() => backend.onAuth(setUser), [backend]);
  useEffect(() => {
    setAllowed(null);
    if (!isDmUser || !user) return;
    let dead = false;
    void isAllowedDM(backend, user).then((a) => { if (!dead) setAllowed(a); });
    return () => { dead = true; };
  }, [backend, user?.uid, isDmUser]);
  useEffect(() => (isDmUser && allowed && user ? watchUserTables(backend, user.uid, setTables) : undefined), [backend, user?.uid, allowed]);

  const signIn = async () => {
    setBusy(true);
    try { await backend.signInGoogle(); }
    catch (e) { toast(asErr(e), 'error'); }
    setBusy(false);
  };
  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const tid = await createTable(backend, user, name.trim() || 'My table');
      location.hash = `#/t/${tid}`;
    } catch (e) {
      toast(`Could not create the table: ${asErr(e)}`, 'error');
    }
    setBusy(false);
  };
  const linkFor = (tid: string) => `${location.href.split('#')[0]}#/t/${tid}`;

  return (
    <div class="screen center">
      <div class="card">
        <h1>⬡ Table</h1>
        <p class="muted">A small virtual tabletop for you and your friends.</p>
        {props.demo && <div class="banner info static">Demo mode: everything is stored in this browser only. See docs/SETUP.md to connect Firebase for real sessions.</div>}

        {!isDmUser && (
          <>
            <button class="btn primary big" disabled={busy} onClick={signIn}>{props.demo ? 'Start as the DM (demo)' : 'DM: sign in with Google'}</button>
            <p class="muted small">Players don't need to sign in. Just open the link your DM sent you.</p>
          </>
        )}

        {isDmUser && allowed === null && <p class="muted">Checking your account…</p>}
        {isDmUser && allowed === false && (
          <>
            <div class="banner error static">{user?.email} is not on the DM allowlist.</div>
            <p class="muted small">Add this email in your Firebase console under <code>config/allowedEmails</code> (see docs/SETUP.md), then sign in again.</p>
            <button class="btn" onClick={() => void backend.signOut()}>Sign out</button>
          </>
        )}
        {isDmUser && allowed && (
          <>
            <div class="row between">
              <span class="muted small">Signed in as {user?.email ?? user?.name}</span>
              <button class="btn small" onClick={() => void backend.signOut()}>Sign out</button>
            </div>
            <h3>Your tables</h3>
            {tables.length === 0 && <p class="muted">No tables yet. Create one below.</p>}
            <ul class="list">
              {tables.map((t) => (
                <li key={t.id}>
                  <a class="grow link" href={`#/t/${t.id}`}>{t.name}</a>
                  <button class="btn small" onClick={() => copyText(linkFor(t.id))}>Copy player link</button>
                  <a class="btn small primary" href={`#/t/${t.id}`}>Open</a>
                </li>
              ))}
            </ul>
            <div class="row">
              <input type="text" class="grow" placeholder="New table name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); }} />
              <button class="btn primary" disabled={busy} onClick={create}>Create table</button>
            </div>
          </>
        )}
      </div>
      <Toasts />
    </div>
  );
}

// ====================================================================== a table (DM or player)
type Phase =
  | { s: 'loading' }
  | { s: 'error'; msg: string; hint?: string }
  | { s: 'join'; client: TableClient; user: AuthUser; tableName: string }
  | { s: 'ready'; client: TableClient; user: AuthUser };

function TableScreen(props: { tid: string; backend: Backend; demo: boolean }) {
  const { backend, tid } = props;
  const [phase, setPhase] = useState<Phase>({ s: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    let client: TableClient | null = null;
    (async () => {
      let user = backend.currentUser();
      if (!user) {
        try { user = await backend.signInAnon(); }
        catch (e) {
          setPhase({ s: 'error', msg: 'Could not sign you in.', hint: backend.kind === 'firebase' ? 'The table owner needs to enable “Anonymous” sign-in in the Firebase console (Authentication → Sign-in method).' : asErr(e) });
          return;
        }
      }
      const owner = await getTableOwner(backend, tid).catch((e) => { throw new Error(asErr(e)); });
      if (dead) return;
      if (!owner) { setPhase({ s: 'error', msg: 'This table was not found.', hint: 'Check that the link is complete, or ask your DM to send it again.' }); return; }
      const role = owner === user.uid ? 'dm' : 'player';
      client = new TableClient(backend, tid, user.uid, role);
      if (role === 'player') {
        const rec = await backend.get(P.player(tid, user.uid));
        if (dead) return;
        if (!rec) {
          const tableName = (await getTableName(backend, tid)) ?? 'Table';
          client.start();
          setPhase({ s: 'join', client, user, tableName });
          return;
        }
      }
      client.start();
      setPhase({ s: 'ready', client, user });
    })().catch((e) => { if (!dead) setPhase({ s: 'error', msg: asErr(e), hint: 'If this keeps happening, check your Firebase rules and config.' }); });
    return () => { dead = true; client?.stop(); };
  }, [backend, tid, attempt]);

  const goHome = () => { location.hash = ''; };

  if (phase.s === 'loading') return <div class="screen center"><div class="splash">Opening table…</div></div>;
  if (phase.s === 'error') {
    return (
      <div class="screen center"><div class="card">
        <h1>Can't open this table</h1>
        <p class="error-text">{phase.msg}</p>
        {phase.hint && <p class="muted">{phase.hint}</p>}
        <div class="row"><button class="btn" onClick={() => setAttempt(attempt + 1)}>Try again</button><button class="btn" onClick={goHome}>Back to start</button></div>
      </div></div>
    );
  }
  if (phase.s === 'join') {
    return <JoinForm client={phase.client} tableName={phase.tableName} onJoined={() => setPhase({ s: 'ready', client: phase.client, user: phase.user })} />;
  }
  return (
    <TableView
      client={phase.client}
      user={phase.user}
      demo={props.demo}
      onHome={goHome}
      onRemoved={() => { void getTableName(backend, tid).then((n) => setPhase({ s: 'join', client: phase.client, user: phase.user, tableName: n ?? 'Table' })); }}
      onSignOut={async () => { await backend.signOut(); goHome(); }}
    />
  );
}

function JoinForm(props: { client: TableClient; tableName: string; onJoined: () => void }) {
  const [name, setName] = useState(() => localStorage.getItem('vtt-name') ?? '');
  const [color, setColor] = useState(() => localStorage.getItem('vtt-color') ?? PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)]);
  const [busy, setBusy] = useState(false);
  useRerender((fn) => props.client.subscribe(fn), [props.client]);
  const taken = useMemo(() => new Set([...props.client.players.values()].map((p) => p.color)), [props.client.players.size]);

  const join = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      localStorage.setItem('vtt-name', name.trim());
      localStorage.setItem('vtt-color', color);
      await props.client.joinAsPlayer(name.trim(), color);
      props.onJoined();
    } catch (e) {
      toast(`Could not join: ${asErr(e)}`, 'error');
      setBusy(false);
    }
  };

  return (
    <div class="screen center">
      <div class="card">
        <h1>Join “{props.tableName}”</h1>
        <label class="field"><span class="field-label">Your name</span>
          <input type="text" autoFocus value={name} placeholder="e.g. Aria" onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void join(); }} />
        </label>
        <div class="field"><span class="field-label">Your colour (used for pings)</span>
          <div class="swatches">
            {PLAYER_COLORS.map((c) => <button key={c} class={`swatch ${color === c ? 'on' : ''} ${taken.has(c) ? 'taken' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} title={taken.has(c) ? 'Already used' : c} />)}
          </div>
        </div>
        <button class="btn primary big" disabled={!name.trim() || busy} onClick={join}>Join table</button>
      </div>
      <Toasts />
    </div>
  );
}
