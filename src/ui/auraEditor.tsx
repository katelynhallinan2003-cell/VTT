import type { Aura } from '../types';

const OPACITIES: { v: number; label: string }[] = [
  { v: 0.12, label: 'Faint' },
  { v: 0.25, label: 'Soft' },
  { v: 0.45, label: 'Strong' },
];

export const NEW_AURA: Aura = { r: 10, color: '#ff6b6b', a: 0.25, shape: 'circle', edge: true, dm: false };

/** Coloured areas that follow a token, measured in feet (auras, emanations, spell effects). */
export function AuraEditor(props: { auras: Aura[]; ft: number; isDM: boolean; disabled?: boolean; /** colour for a new aura (the token's ring colour) */ defaultColor?: string; compact?: boolean; onChange: (a: Aura[]) => void }) {
  const { auras } = props;
  const upd = (i: number, patch: Partial<Aura>) => props.onChange(auras.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  return (
    <div class="auras">
      {!props.compact && <h3>Auras</h3>}
      {auras.length === 0 && <p class="muted small">Coloured areas around a token, such as a paladin's aura or a lingering spell. They follow the token and are measured in feet.</p>}
      {auras.map((a, i) => (
        <div class="aura-row" key={i}>
          <input type="number" class="aura-r" min={0} max={500} step={props.ft} value={a.r} disabled={props.disabled}
            title="Radius in feet" onInput={(e) => upd(i, { r: Math.max(0, Number((e.target as HTMLInputElement).value) || 0) })} />
          <span class="muted small">ft</span>
          <input type="color" value={a.color} disabled={props.disabled} onInput={(e) => upd(i, { color: (e.target as HTMLInputElement).value })} />
          <select value={a.shape} disabled={props.disabled} onChange={(e) => upd(i, { shape: (e.target as HTMLSelectElement).value as Aura['shape'] })}>
            <option value="circle">Round</option>
            <option value="square">Square</option>
          </select>
          <select value={String(a.a)} disabled={props.disabled} onChange={(e) => upd(i, { a: Number((e.target as HTMLSelectElement).value) })}>
            {!OPACITIES.some((o) => o.v === a.a) && <option value={String(a.a)}>Custom</option>}
            {OPACITIES.map((o) => <option value={String(o.v)}>{o.label}</option>)}
          </select>
          <label class="inline-check" title="Measure from the edge of the token, as 5e emanations do. Off measures from its centre.">
            <input type="checkbox" checked={a.edge} disabled={props.disabled} onChange={(e) => upd(i, { edge: (e.target as HTMLInputElement).checked })} /> edge
          </label>
          {props.isDM && (
            <label class="inline-check" title="Only you see this aura">
              <input type="checkbox" checked={a.dm} disabled={props.disabled} onChange={(e) => upd(i, { dm: (e.target as HTMLInputElement).checked })} /> DM only
            </label>
          )}
          <button class="btn small" disabled={props.disabled} title="Remove this aura" onClick={() => props.onChange(auras.filter((_, k) => k !== i))}>✕</button>
        </div>
      ))}
      <button class="btn small" disabled={props.disabled || auras.length >= 6} onClick={() => props.onChange([...auras, { ...NEW_AURA, color: props.defaultColor ?? NEW_AURA.color, r: Math.max(5, props.ft * 2) }])}>+ Add aura</button>
    </div>
  );
}
