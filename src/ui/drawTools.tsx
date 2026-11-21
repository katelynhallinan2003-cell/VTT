import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { Board } from '../board/Board';
import { DRAW_COLORS, DRAW_NAME, FILL_LEVEL, FONTS, LINE_H, STROKE_CELLS, fillModeOf, fontStack, isTemplate, sizeFt, withSizeFt, type FillMode } from '../core/draw';
import type { TableClient } from '../state/client';
import type { DrawTool, StrokeSize, TemplateKind, UiState } from '../state/ui';
import { ZONE_PRESETS, zoneColor } from '../core/height';
import { isHex } from '../core/hex';
import type { Drawing } from '../types';
import { Toggle, toast, useClient, useUi } from './common';

const TOOLS: { id: DrawTool; label: string; hint: string }[] = [
  { id: 'pen', label: 'Pen', hint: 'Hold and drag to draw freehand.' },
  { id: 'line', label: 'Line', hint: 'Drag from one point to another. Hold Shift to lock the angle.' },
  { id: 'arrow', label: 'Arrow', hint: 'Drag to point at something. Hold Shift to lock the angle.' },
  { id: 'rect', label: 'Box', hint: 'Drag a box. Hold Shift for a square. Drag the dots on it to resize.' },
  { id: 'ellipse', label: 'Circle', hint: 'Drag out a circle or oval. Hold Shift for a perfect circle.' },
  { id: 'text', label: 'Text', hint: 'Click where the words should go, type, press Enter (Shift+Enter for a new line). Click text again to change it.' },
  { id: 'erase', label: 'Erase', hint: 'Click or swipe over drawings to remove them.' },
];

const TEMPLATES: { id: TemplateKind; label: string; hint: string }[] = [
  { id: 'cone', label: 'Cone', hint: 'Click the middle of the edge of the caster\'s square and drag out. It is as wide at the far end as it is long.' },
  { id: 'cube', label: 'Cube', hint: 'Click on one face and drag out. The distance is the side length, and it lines up with the squares.' },
  { id: 'sphere', label: 'Sphere', hint: 'Click the centre and drag out the radius. The centre snaps to the middle of a square, a corner, or nowhere: your choice below.' },
  { id: 'emanation', label: 'Emanation', hint: 'Click the square it comes out of and drag out. Its size is counted from the edge of that square, and the square itself is left out.' },
  { id: 'beam', label: 'Line', hint: 'Click where it starts and drag out the length. Pick its width below.' },
];

function Colors(props: { value: string; onPick: (c: string) => void; /** shown for a colour that can also be "the same as the outline" (value '') */ sameLabel?: string; fallback?: string; small?: boolean }) {
  const shown = props.value || props.fallback || '#e03131';
  return (
    <div class={`swatches ${props.small ? 'small' : ''}`}>
      {props.sameLabel !== undefined && (
        <button class={`swatch same ${props.value === '' ? 'on' : ''}`} title={props.sameLabel} aria-label={props.sameLabel} onClick={() => props.onPick('')}>＝</button>
      )}
      {DRAW_COLORS.map((c) => (
        <button key={c} class={`swatch ${props.value.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => props.onPick(c)} />
      ))}
      <input type="color" value={shown} title="Any colour" onInput={(e) => props.onPick((e.target as HTMLInputElement).value)} />
    </div>
  );
}

const FILL_LABEL: Record<FillMode, string> = { none: 'None', light: 'See-through', solid: 'Solid' };

/** None / see-through / solid, plus the fill colour (which can follow the outline). */
function FillControls(props: { mode: FillMode; color: string; outline: string; onMode: (m: FillMode) => void; onColor: (c: string) => void }) {
  return (
    <>
      <div class="seg">
        {(['none', 'light', 'solid'] as FillMode[]).map((m) => <button key={m} class={props.mode === m ? 'on' : ''} onClick={() => props.onMode(m)}>{FILL_LABEL[m]}</button>)}
      </div>
      {props.mode !== 'none' && (
        <div>
          <span class="field-label">Fill colour</span>
          <Colors value={props.color} fallback={props.outline} sameLabel="Same as the outline" small onPick={props.onColor} />
        </div>
      )}
    </>
  );
}

/** Bold, italic and underline buttons. */
function StyleButtons(props: { b: boolean; i: boolean; u: boolean; onB: (v: boolean) => void; onI: (v: boolean) => void; onU: (v: boolean) => void }) {
  return (
    <div class="seg style-btns">
      <button class={props.b ? 'on' : ''} title="Bold" aria-label="Bold" onClick={() => props.onB(!props.b)}><b>B</b></button>
      <button class={props.i ? 'on' : ''} title="Italic" aria-label="Italic" onClick={() => props.onI(!props.i)}><i>I</i></button>
      <button class={props.u ? 'on' : ''} title="Underline" aria-label="Underline" onClick={() => props.onU(!props.u)}><u>U</u></button>
    </div>
  );
}

function FontSelect(props: { value: string; onChange: (k: string) => void }) {
  return (
    <select value={props.value} aria-label="Font" onChange={(e) => props.onChange((e.target as HTMLSelectElement).value)}>
      {FONTS.map((f) => <option key={f.key} value={f.key} style={{ fontFamily: f.stack }}>{f.label}</option>)}
    </select>
  );
}

/** A number box that applies when you press Enter or click away. Out-of-range numbers are ignored. */
function NumField(props: { label: string; value: number; min?: number; max?: number; step?: number; unit?: string; title?: string; onCommit: (n: number) => void }) {
  return (
    <label class="numf" title={props.title}>
      <span>{props.label}</span>
      <input key={props.value} type="number" defaultValue={props.value} min={props.min} max={props.max} step={props.step ?? 1}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onChange={(e) => {
          const n = Number((e.target as HTMLInputElement).value);
          if (Number.isFinite(n) && (props.min === undefined || n >= props.min) && (props.max === undefined || n <= props.max) && n !== props.value) props.onCommit(n);
          else (e.target as HTMLInputElement).value = String(props.value);
        }} />
      {props.unit && <span class="unit">{props.unit}</span>}
    </label>
  );
}

export function DrawFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const tool = TOOLS.find((t) => t.id === d.drawTool) ?? TOOLS[0];
  const allowed = client.canDo('draw');
  const closed = d.drawTool === 'rect' || d.drawTool === 'ellipse';
  const isText = d.drawTool === 'text';
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
          {(['thin', 'medium', 'thick'] as StrokeSize[]).map((s) => <button key={s} class={d.drawSize === s ? 'on' : ''} onClick={() => ui.set({ drawSize: s })}>{isText ? (s === 'thin' ? 'Small' : s === 'medium' ? 'Medium' : 'Large') : s === 'thin' ? 'Thin' : s === 'medium' ? 'Medium' : 'Thick'}</button>)}
        </div>
      )}
      {closed && <FillControls mode={d.drawFillMode} color={d.drawFillColor} outline={d.drawColor} onMode={(m) => ui.set({ drawFillMode: m })} onColor={(c) => ui.set({ drawFillColor: c })} />}
      {isText && (
        <div class="row wrap">
          <FontSelect value={d.textFont} onChange={(k) => ui.set({ textFont: k })} />
          <StyleButtons b={d.textBold} i={d.textItalic} u={d.textUnderline} onB={(v) => ui.set({ textBold: v })} onI={(v) => ui.set({ textItalic: v })} onU={(v) => ui.set({ textUnderline: v })} />
        </div>
      )}
      {wide && !isText && <Toggle checked={d.drawDash} onChange={(v) => ui.set({ drawDash: v })} label="Dashed" />}
      <p class="hint">{tool.hint}</p>
      <div class="row wrap">
        <button class="btn small" onClick={async () => { const n = await client.clearDrawings((x) => x.uid === client.uid && !isTemplate(x.k) && x.hz == null, 'Clear my drawings'); toast(n ? `Cleared ${n} drawing${n > 1 ? 's' : ''}` : 'Nothing of yours to clear', 'info', 1800); }}>Clear mine</button>
        {client.isDM && <button class="btn small danger" onClick={async () => { const n = await client.clearDrawings((x) => !isTemplate(x.k) && x.hz == null, 'Clear all drawings'); toast(n ? `Cleared ${n} drawing${n > 1 ? 's' : ''}` : 'No drawings to clear', 'info', 1800); }}>Clear all</button>}
      </div>
    </div>
  );
}

export function HeightFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  useClient(client);
  const count = [...(client.scene?.draws.values() ?? [])].filter((x) => x.hz != null).length;
  return (
    <div class="flyout">
      <div class="flyout-title">Heights</div>
      <p class="hint">Draw the high and low ground. Anything that walks onto it is lifted to that height, and the ruler counts the climb. Flying tokens keep their own altitude.</p>
      <div class="seg">
        <button class={d.heightShape === 'rect' ? 'on' : ''} onClick={() => ui.set({ heightShape: 'rect' })}>Box</button>
        <button class={d.heightShape === 'ellipse' ? 'on' : ''} onClick={() => ui.set({ heightShape: 'ellipse' })}>Circle</button>
      </div>
      <NumField label="Ground height" value={d.heightFt} min={-1000} max={5000} step={5} unit="ft" title="How high this ground is above the base level of the map. Negative is a pit." onCommit={(n) => ui.set({ heightFt: Math.round(n) })} />
      <div class="chips">
        {ZONE_PRESETS.map((h) => (
          <button key={h} class={`chip ${d.heightFt === h ? 'on' : ''}`} style={{ borderColor: zoneColor(h) }} onClick={() => ui.set({ heightFt: h })}>{h > 0 ? `+${h}` : h}</button>
        ))}
      </div>
      <Toggle checked={d.showHeights} onChange={(v) => ui.set({ showHeights: v })} label="Show heights on the map" hint="Only changes what you see. Everyone gets the same ground." />
      <p class="hint">Drag out a box or circle. Click the edge of one to select it, move it, resize it, or change its height. Smaller ones sit on top of bigger ones, so draw a nest inside a cliff. {'] and [ raise and lower the selected tokens.'}</p>
      <div class="row wrap">
        <span class="hint">{count ? `${count} height area${count > 1 ? 's' : ''} on this map` : 'No height areas yet'}</span>
        <span class="grow" />
        {count > 0 && <button class="btn small danger" onClick={async () => { const n = await client.clearDrawings((x) => x.hz != null, 'Clear all heights'); toast(n ? `Cleared ${n} height area${n > 1 ? 's' : ''}` : 'No heights to clear', 'info', 1800); }}>Clear all heights</button>}
      </div>
    </div>
  );
}

export function TemplateFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const t = TEMPLATES.find((x) => x.id === d.tplKind) ?? TEMPLATES[0];
  const hex = isHex(client.grid);
  // on a hex grid "square" becomes "hex", and a cube or line lines up with the six directions between hexes
  const say = (x: string) => (hex ? x.replace(/\bsquares\b/g, 'hexes').replace(/\ba square\b/g, 'a hex').replace(/\bsquare\b/g, 'hex') : x);
  return (
    <div class="flyout">
      <div class="flyout-title">Spell templates</div>
      {!client.canDo('draw') && <p class="hint">Placing templates is turned off for players.</p>}
      <div class="seg wrap">
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
      {d.tplKind === 'sphere' && (
        <>
          <span class="field-label">Snap the centre to</span>
          <div class="seg wrap">
            {([['center', hex ? 'Middle of a hex' : 'Middle of a square'], ['corner', 'Corner'], ['off', 'Nothing']] as const).map(([k, label]) => (
              <button key={k} class={d.tplSphereSnap === k ? 'on' : ''} onClick={() => ui.set({ tplSphereSnap: k })}>{label}</button>
            ))}
          </div>
        </>
      )}
      <Toggle checked={d.tplCover} onChange={(v) => ui.set({ tplCover: v })} label={hex ? 'Show the hexes it covers' : 'Show the squares it covers'} hint={hex ? 'A hex counts when its middle is inside the area.' : 'A square counts when its middle is inside the area.'} />
      <p class="hint">{say(t.hint)} {say('Sizes snap to whole squares')} (hold Alt to turn that off, Shift to lock the angle).</p>
      <div class="row wrap">
        <button class="btn small" onClick={async () => { const n = await client.clearDrawings((x) => isTemplate(x.k), 'Clear templates'); toast(n ? `Cleared ${n} template${n > 1 ? 's' : ''}` : 'No templates to clear', 'info', 1800); }}>
          {client.isDM ? 'Clear all templates' : 'Clear my templates'}
        </button>
      </div>
    </div>
  );
}

export function RulerFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const mine = client.me?.color ?? '#ffffff';
  return (
    <div class="flyout">
      <div class="flyout-title">Ruler</div>
      {!client.canDo('measure') && <p class="hint">The ruler is turned off for players.</p>}
      <p class="hint">Drag to measure. Hold Alt to measure freely instead of from square to square (or hex to hex). Esc clears it.</p>
      <span class="field-label">Colour</span>
      <Colors value={d.rulerColor} fallback={mine} sameLabel="Use my player colour" onPick={(c) => ui.set({ rulerColor: c })} />
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

/** The box you type in. It sits exactly where the text will be, at the same size, and follows the map when it moves or zooms. */
export function TextEditor(props: { ui: UiState; client: TableClient; board: Board | null }) {
  const { ui, client, board } = props;
  const d = useUi(ui);
  useClient(client);
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);
  const te = d.textEdit;
  const existing = te?.id ? client.scene?.draws.get(te.id) : undefined;
  useEffect(() => { finished.current = false; if (te) setTimeout(() => { const el = ref.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, 0); }, [te?.id, te?.x, te?.y]);
  const style = te && board ? (existing ?? { ...board.textDefaults(), txt: '' }) : null;
  const text = existing?.txt ?? '';
  // grow with what is typed
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.width = '10px';
    el.style.height = '10px';
    el.style.width = `${el.scrollWidth + 6}px`;
    el.style.height = `${el.scrollHeight}px`;
  };
  useLayoutEffect(() => { fit(); });
  if (!te || !board || !style) return null;
  const done = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    board.finishText(commit, ref.current?.value ?? '');
  };
  const z = board.zoomNow;
  const pos = board.worldToScreen({ x: te.x, y: te.y });
  return (
    <textarea ref={ref} class="text-editor" defaultValue={text} rows={1} spellcheck={false} placeholder="Type here"
      key={`${te.id ?? 'new'}:${te.x}:${te.y}`}
      style={{
        left: `${pos.x}px`, top: `${pos.y}px`, fontSize: `${style.fs * z}px`, lineHeight: `${LINE_H}`,
        color: style.color, fontFamily: fontStack(style.font), fontWeight: style.b ? '700' : '400', fontStyle: style.i ? 'italic' : 'normal',
        textDecoration: style.u ? 'underline' : 'none',
      }}
      onInput={fit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } }}
      onBlur={() => done(true)} />
  );
}

/** The panel at the bottom for whatever drawing is selected: colours, fill, size, text style. */
export function DrawInspector(props: { ui: UiState; client: TableClient; board: Board | null }) {
  const { ui, client, board } = props;
  useClient(client);
  const d = useUi(ui);
  const list = [...d.drawSel].map((id) => client.scene?.draws.get(id)).filter((x): x is Drawing => !!x && client.canEditDrawing(x));
  if (!list.length || d.textEdit) return null;
  const one = list.length === 1 ? list[0] : null;
  const first = list[0];
  const ids = list.map((x) => x.id);
  const upd = (patch: Parameters<TableClient['updateDrawings']>[1]) => { void client.updateDrawings(ids, patch); };
  const allText = list.every((x) => x.k === 'text');
  const allClosed = list.every((x) => x.k === 'rect' || x.k === 'ellipse');
  const allTemplates = list.every((x) => isTemplate(x.k));
  const allZones = list.every((x) => x.hz != null);
  const strokeKey = (['thin', 'medium', 'thick'] as StrokeSize[]).reduce((best, k) => (Math.abs(STROKE_CELLS[k] * client.grid.cell - first.w) < Math.abs(STROKE_CELLS[best] * client.grid.cell - first.w) ? k : best), 'medium' as StrokeSize);
  const size = one ? sizeFt(one, client.grid) : null;
  const ft = client.grid.ft;
  return (
    <div class="drawtag" onMouseDown={(e) => e.stopPropagation()}>
      <div class="dt-head">
        <strong>{allZones ? (one ? 'Height area' : `${list.length} height areas`) : one ? DRAW_NAME[one.k] : `${list.length} drawings`}</strong>
        <span class="grow" />
        {one?.k === 'text' && <button class="btn small" title="Change the words (Enter)" onClick={() => board?.startTextEdit(one)}>Edit text</button>}
        <button class="btn small danger" title="Delete (Del)" onClick={() => { void client.removeDrawings(ids); ui.selectDrawings([]); }}>Delete</button>
        <button class="icon-btn" title="Deselect" onClick={() => ui.selectDrawings([])}>✕</button>
      </div>
      <div class="dt-body">
        {allZones && (
          <div>
            <NumField label="Ground height" value={first.hz ?? 0} min={-1000} max={5000} step={5} unit="ft" title="How high this ground is above the base level of the map"
              onCommit={(n) => { const h = Math.round(n); upd({ hz: h, color: zoneColor(h), fc: zoneColor(h) }); }} />
            <div class="chips">
              {ZONE_PRESETS.map((h) => (
                <button key={h} class={`chip ${first.hz === h ? 'on' : ''}`} style={{ borderColor: zoneColor(h) }} onClick={() => upd({ hz: h, color: zoneColor(h), fc: zoneColor(h) })}>{h > 0 ? `+${h}` : h}</button>
              ))}
            </div>
          </div>
        )}
        {!allZones && <div>
          <span class="field-label">{allText ? 'Text colour' : allClosed ? 'Outline colour' : 'Colour'}</span>
          <Colors value={first.color} small onPick={(c) => upd({ color: c })} />
        </div>}
        {allClosed && !allZones && (
          <div>
            <span class="field-label">Fill</span>
            <FillControls mode={fillModeOf(first.fill)} color={first.fc} outline={first.color}
              onMode={(m) => upd({ fill: FILL_LEVEL[m] })} onColor={(c) => upd({ fc: c })} />
          </div>
        )}
        {allTemplates && (
          <label class="field"><span class="field-label">Opacity</span>
            <input type="range" min={10} max={100} value={Math.round((first.fill || 0.28) * 100)} onInput={(e) => upd({ fill: Number((e.target as HTMLInputElement).value) / 100 })} /></label>
        )}
        {!allText && !allTemplates && !allZones && (
          <div class="row wrap">
            <div class="seg">
              {(['thin', 'medium', 'thick'] as StrokeSize[]).map((k) => <button key={k} class={strokeKey === k ? 'on' : ''} onClick={() => upd({ w: Math.max(1.5, STROKE_CELLS[k] * client.grid.cell) })}>{k === 'thin' ? 'Thin' : k === 'medium' ? 'Medium' : 'Thick'}</button>)}
            </div>
            <Toggle checked={first.dash} onChange={(v) => upd({ dash: v })} label="Dashed" />
          </div>
        )}
        {one && size && 'w' in size && (
          <div class="row wrap">
            <NumField label="Width" value={size.w} min={1} max={2000} step={ft} unit="ft" title="Width in feet" onCommit={(n) => { const p = withSizeFt(one, client.grid, 'w', n); if (p.p) upd(p); }} />
            <NumField label={allZones ? 'Length' : 'Height'} value={size.h} min={1} max={2000} step={ft} unit="ft" title={allZones ? 'Length in feet, top to bottom on the map' : 'Height in feet'} onCommit={(n) => { const p = withSizeFt(one, client.grid, 'h', n); if (p.p) upd(p); }} />
          </div>
        )}
        {one && size && 'len' in size && (
          <NumField label="Length" value={size.len} min={1} max={2000} step={ft} unit="ft" title="Length in feet" onCommit={(n) => { const p = withSizeFt(one, client.grid, 'len', n); if (p.p) upd(p); }} />
        )}
        {allText && (
          <div class="row wrap">
            <FontSelect value={first.font} onChange={(k) => upd({ font: k })} />
            <NumField label="Size" value={Math.round((first.fs / client.grid.cell) * 100)} min={5} max={1000} unit="%" title="Letter height as a percentage of a grid square"
              onCommit={(n) => upd({ fs: Math.min(400, Math.max(6, Math.round((n / 100) * client.grid.cell * 10) / 10)) })} />
            <StyleButtons b={first.b} i={first.i} u={first.u} onB={(v) => upd({ b: v })} onI={(v) => upd({ i: v })} onU={(v) => upd({ u: v })} />
            <Toggle checked={!first.ho} onChange={(v) => upd({ ho: !v })} label="Outline" />
          </div>
        )}
      </div>
      <p class="hint">Drag it to move it · drag the white dots to resize · arrow keys nudge it · Del removes it</p>
    </div>
  );
}
