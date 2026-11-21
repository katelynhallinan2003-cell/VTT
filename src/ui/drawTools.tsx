import { useEffect, useRef } from 'preact/hooks';
import type { Board } from '../board/Board';
import { DRAW_COLORS } from '../core/draw';
import type { TableClient } from '../state/client';
import type { DrawTool, StrokeSize, TemplateKind, UiState } from '../state/ui';
import { Toggle, toast, useUi } from './common';

const TOOLS: { id: DrawTool; label: string; hint: string }[] = [
  { id: 'pen', label: 'Pen', hint: 'Hold and drag to draw freehand.' },
  { id: 'line', label: 'Line', hint: 'Drag from one point to another. Hold Shift to lock the angle.' },
  { id: 'arrow', label: 'Arrow', hint: 'Drag to point at something. Hold Shift to lock the angle.' },
  { id: 'rect', label: 'Box', hint: 'Drag a box. Hold Shift for a square.' },
  { id: 'ellipse', label: 'Circle', hint: 'Drag out a circle or oval. Hold Shift for a perfect circle.' },
  { id: 'text', label: 'Text', hint: 'Click where the words should go, type, press Enter.' },
  { id: 'erase', label: 'Erase', hint: 'Click or swipe over drawings to remove them.' },
];

const TEMPLATES: { id: TemplateKind; label: string; hint: string }[] = [
  { id: 'cone', label: 'Cone', hint: 'Drag out from the caster. It is as wide at the far end as it is long.' },
  { id: 'cube', label: 'Cube', hint: 'Drag out from one face of the cube. The distance is the side length.' },
  { id: 'sphere', label: 'Sphere', hint: 'Click the centre and drag out the radius.' },
  { id: 'beam', label: 'Line', hint: 'Drag out the length of the line. Pick its width below.' },
];

function Colors(props: { value: string; onPick: (c: string) => void }) {
  return (
    <div class="swatches">
      {DRAW_COLORS.map((c) => (
        <button key={c} class={`swatch ${props.value.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => props.onPick(c)} />
      ))}
      <input type="color" value={props.value} title="Any colour" onInput={(e) => props.onPick((e.target as HTMLInputElement).value)} />
    </div>
  );
}

export function DrawFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const tool = TOOLS.find((t) => t.id === d.drawTool) ?? TOOLS[0];
  const allowed = client.canDo('draw');
  const closed = d.drawTool === 'rect' || d.drawTool === 'ellipse';
  const wide = d.drawTool !== 'erase';
  return (
    <div class="flyout">
      <div class="flyout-title">Draw</div>
      {!allowed && <p class="hint">Drawing is turned off for players.</p>}
      <div class="seg wrap">
        {TOOLS.map((t) => <button key={t.id} class={d.drawTool === t.id ? 'on' : ''} onClick={() => ui.set({ drawTool: t.id })}>{t.label}</button>)}
      </div>
      {wide && <Colors value={d.drawColor} onPick={(c) => ui.set({ drawColor: c })} />}
      {wide && (
        <div class="seg">
          {(['thin', 'medium', 'thick'] as StrokeSize[]).map((s) => <button key={s} class={d.drawSize === s ? 'on' : ''} onClick={() => ui.set({ drawSize: s })}>{s === 'thin' ? 'Thin' : s === 'medium' ? 'Medium' : 'Thick'}</button>)}
        </div>
      )}
      {closed && <Toggle checked={d.drawFill} onChange={(v) => ui.set({ drawFill: v })} label="Fill in" />}
      {wide && d.drawTool !== 'text' && <Toggle checked={d.drawDash} onChange={(v) => ui.set({ drawDash: v })} label="Dashed" />}
      <p class="hint">{tool.hint}</p>
      <div class="row wrap">
        <button class="btn small" onClick={async () => { const n = await client.clearDrawings((x) => x.uid === client.uid && !['cone', 'cube', 'sphere', 'beam'].includes(x.k), 'Clear my drawings'); toast(n ? `Cleared ${n} drawing${n > 1 ? 's' : ''}` : 'Nothing of yours to clear', 'info', 1800); }}>Clear mine</button>
        {client.isDM && <button class="btn small danger" onClick={async () => { const n = await client.clearDrawings((x) => !['cone', 'cube', 'sphere', 'beam'].includes(x.k), 'Clear all drawings'); toast(n ? `Cleared ${n} drawing${n > 1 ? 's' : ''}` : 'No drawings to clear', 'info', 1800); }}>Clear all</button>}
      </div>
    </div>
  );
}

export function TemplateFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const t = TEMPLATES.find((x) => x.id === d.tplKind) ?? TEMPLATES[0];
  return (
    <div class="flyout">
      <div class="flyout-title">Spell templates</div>
      {!client.canDo('draw') && <p class="hint">Placing templates is turned off for players.</p>}
      <div class="seg">
        {TEMPLATES.map((x) => <button key={x.id} class={d.tplKind === x.id ? 'on' : ''} onClick={() => ui.set({ tplKind: x.id })}>{x.label}</button>)}
      </div>
      <Colors value={d.drawColor} onPick={(c) => ui.set({ drawColor: c })} />
      {d.tplKind === 'beam' && (
        <label class="field"><span class="field-label">Line width</span>
          <select value={d.tplWidth} onChange={(e) => ui.set({ tplWidth: Number((e.target as HTMLSelectElement).value) })}>
            {[5, 10, 15, 20, 30].map((w) => <option value={w}>{w} ft</option>)}
          </select>
        </label>
      )}
      <p class="hint">{t.hint} Sizes snap to whole squares (hold Alt to turn that off, Shift to lock the angle).</p>
      <div class="row wrap">
        <button class="btn small" onClick={async () => { const n = await client.clearDrawings((x) => ['cone', 'cube', 'sphere', 'beam'].includes(x.k), 'Clear templates'); toast(n ? `Cleared ${n} template${n > 1 ? 's' : ''}` : 'No templates to clear', 'info', 1800); }}>
          {client.isDM ? 'Clear all templates' : 'Clear my templates'}
        </button>
      </div>
    </div>
  );
}

export function RulerFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const g = client.grid;
  return (
    <div class="flyout">
      <div class="flyout-title">Ruler</div>
      {!client.canDo('measure') && <p class="hint">The ruler is turned off for players.</p>}
      <p class="hint">Drag to measure. Distances use your grid rule ({g.rule === 'chebyshev' ? 'every diagonal is one square' : g.rule === 'alt' ? '5-10-5 diagonals' : 'true distance'}, {g.ft} ft per square). Hold Alt to measure freely instead of from square to square. Esc clears it.</p>
      <Toggle checked={d.sharePlot} onChange={(v) => ui.set({ sharePlot: v })} label="Show my ruler to everyone" hint="Off by default so planning doesn't distract the table." />
    </div>
  );
}

/** The bar shown while "test move" is on. */
export function TestMoveBar(props: { ui: UiState; board: Board | null }) {
  const { ui, board } = props;
  const d = useUi(ui);
  if (!d.testMove) return null;
  return (
    <div class="testbar">
      <strong>Test move</strong>
      <span class="muted small">{d.testCount ? `${d.testCount} token${d.testCount > 1 ? 's' : ''} moved` : 'Drag a token to try a move'}</span>
      <button class="btn small primary" disabled={!d.testCount} onClick={() => board?.keepTestMoves()} title="Make the move for real (Enter)">Keep</button>
      <button class="btn small" disabled={!d.testCount} onClick={() => board?.resetTestMoves()} title="Put them back (Esc)">Reset</button>
      <label class="toggle small" title="Let everyone see a ghost of where you are trying to go">
        <input type="checkbox" checked={d.sharePlot} onChange={(e) => ui.set({ sharePlot: (e.target as HTMLInputElement).checked })} />
        <span class="toggle-text">Show others</span>
      </label>
      <button class="btn small" onClick={() => ui.set({ testMove: false })}>Done</button>
    </div>
  );
}

/** A small text box where the text tool was clicked. */
export function TextBox(props: { ui: UiState; board: Board | null }) {
  const { ui, board } = props;
  const d = useUi(ui);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const at = d.textAt;
  useEffect(() => { finished.current = false; if (at) setTimeout(() => ref.current?.focus(), 0); }, [at?.x, at?.y]);
  if (!at) return null;
  const done = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const v = ref.current?.value ?? '';
    ui.set({ textAt: null });
    if (commit && v.trim()) board?.addText({ x: at.x, y: at.y }, v);
  };
  return (
    <input ref={ref} class="textbox" type="text" maxLength={120} placeholder="Type, then Enter"
      style={{ left: `${at.sx}px`, top: `${at.sy - 16}px` }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); }}
      onBlur={() => done(true)} />
  );
}
