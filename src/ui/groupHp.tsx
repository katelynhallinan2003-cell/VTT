import { useRef, useState } from 'preact/hooks';
import { applyDamage, pctOf } from '../core/combat';
import type { TableClient } from '../state/client';
import type { Token } from '../types';
import { toast } from './common';
import { HpBar, tellTemp, tempPct } from './initiative';

export type GroupHpMode = 'damage' | 'heal' | 'temp';

/** How much one token takes: half (rounded down) when it is marked as having saved. */
export const shareOf = (amount: number, half: boolean): number => (half ? Math.floor(amount / 2) : amount);

/**
 * Hit points for several selected tokens at once: type one number, tick who is hit, mark who only takes half (a saving throw), and apply.
 * Damage, healing and temporary hit points each go in one undo step; every row shows what the token will have afterwards.
 */
export function GroupHpPop(props: { client: TableClient; tokens: Token[] }) {
  const { client, tokens } = props;
  const [text, setText] = useState('');
  const [mode, setMode] = useState<GroupHpMode>('damage');
  const [off, setOff] = useState<Set<string>>(new Set());
  const [half, setHalf] = useState<Set<string>>(new Set());
  const box = useRef<HTMLInputElement>(null);
  const flip = (set: Set<string>, put: (s: Set<string>) => void, id: string) => { const n = new Set(set); if (!n.delete(id)) n.add(id); put(n); };
  const amount = /^\d+$/.test(text.trim()) ? parseInt(text.trim(), 10) : null;
  const ready = amount != null && amount > 0;
  const chosen = tokens.filter((t) => !off.has(t.id));
  const preview = (t: Token): { hp: number; tempHp: number } | null => {
    if (!ready || off.has(t.id) || t.hp == null || t.maxHp == null) return null;
    if (mode === 'temp') return { hp: t.hp, tempHp: Math.max(t.tempHp, amount) };
    const share = shareOf(amount, mode === 'damage' && half.has(t.id));
    return applyDamage(t.hp, t.maxHp, t.tempHp, mode === 'heal' ? -share : share);
  };

  const apply = () => {
    if (!ready) {
      toast('Type how many hit points in the box first.', 'info', 2400);
      box.current?.focus();
      return;
    }
    if (!chosen.length) { toast('Tick at least one token.', 'info', 2400); return; }
    const done = () => { setText(''); box.current?.focus(); };
    if (mode === 'temp') {
      void client.giveTemp(chosen.map((t) => t.id), amount).then((r) => tellTemp(r, amount));
      done();
      return;
    }
    const sign = mode === 'heal' ? -1 : 1;
    const halved = (t: Token) => mode === 'damage' && half.has(t.id);
    const list = chosen.map((t) => ({ id: t.id, amount: sign * shareOf(amount, halved(t)) }));
    void client.hurt(list, mode === 'heal' ? 'Healing' : 'Damage').then((r) => {
      const halves = chosen.filter(halved).length;
      toast(`${mode === 'heal' ? 'Healed' : 'Damaged'} ${r.length} token${r.length === 1 ? '' : 's'} by ${amount}${halves ? ` (${halves} took half)` : ''}.`, 'ok', 2400);
    });
    done();
  };

  return (
    <div class="tt-pop group-hp" role="dialog" aria-label="Hit points for the selected tokens" onKeyDown={(e) => e.stopPropagation()}>
      <div class="row wrap" style={{ alignItems: 'center' }}>
        <div class="seg" role="group" aria-label="What to do">
          {([['damage', 'Damage'], ['heal', 'Heal'], ['temp', 'Temp HP']] as const).map(([k, label]) => (
            <button key={k} class={mode === k ? 'on' : ''} aria-pressed={mode === k} style={{ whiteSpace: 'nowrap' }} onClick={() => setMode(k)}>{label}</button>
          ))}
        </div>
        <input ref={box} type="text" inputMode="numeric" class="num" placeholder="How many" aria-label="How many hit points" value={text} autoFocus
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
            // an empty box has nothing of its own to undo, so Ctrl+Z takes back the last hit
            else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !text) {
              e.preventDefault();
              const dir = e.shiftKey ? 'redo' : 'undo';
              void client.history[dir]().then((label) => toast(label ? `${dir === 'undo' ? 'Undid' : 'Redid'}: ${label}` : `Nothing to ${dir}`, 'info', 1800));
            }
            e.stopPropagation();
          }} />
        <button class="btn small primary" onClick={apply}>Apply to {chosen.length}</button>
      </div>
      <ul class="group-hp-list">
        {tokens.map((t) => {
          const pv = preview(t);
          const off1 = off.has(t.id);
          return (
            <li key={t.id} class={off1 ? 'off' : ''}>
              <input type="checkbox" checked={!off1} aria-label={`Include ${t.name || 'token'}`} onChange={() => flip(off, setOff, t.id)} />
              <span class="gh-name">{t.name || 'Unnamed'}</span>
              <HpBar pct={pctOf(t.hp ?? 0, t.maxHp ?? 1) ?? 0} width={46} temp={tempPct(t)} />
              <span class="gh-now">{t.hp}/{t.maxHp}{t.tempHp > 0 && <span class="temp-hp"> +{t.tempHp}</span>}</span>
              <span class="gh-next" aria-label="Afterwards">{pv ? <>→ {pv.hp}{pv.tempHp > 0 && <span class="temp-hp"> +{pv.tempHp}</span>}</> : ''}</span>
              <button class={`chip ${half.has(t.id) ? 'on' : ''}`} aria-pressed={half.has(t.id)} disabled={mode !== 'damage'}
                title="It made its saving throw: it takes half (rounded down)" onClick={() => flip(half, setHalf, t.id)}>½</button>
            </li>
          );
        })}
      </ul>
      <p class="hint">Hold Shift and click tokens, or drag a box round them, to pick who is hit. Tick ½ for those who made the save.</p>
    </div>
  );
}
