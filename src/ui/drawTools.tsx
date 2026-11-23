import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import type { Board } from '../board/Board';
import { DRAW_COLORS, DRAW_NAME, FILL_LEVEL, FONTS, LINE_H, STROKE_CELLS, fillModeOf, fontStack, isTemplate, sizeFt, withSizeFt, type FillMode } from '../core/draw';
import type { TableClient } from '../state/client';
import { terrainBrushMode, type DrawTool, type StrokeSize, type TemplateKind, type UiState } from '../state/ui';
import { ZONE_PRESETS, dayOf, roughOf, zoneColor, zonesOf } from '../core/height';
import { areasSelected } from '../core/terrain';
import { isHex } from '../core/hex';
import { currentOverlay } from '../core/gridOverlay';
import { WALL_KINDS, WALL_NAME, wallVisDefault, type WallKind } from '../core/walls';
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

/** Changes made in a drawing panel also go to the drawings that are selected (the ones you just drew), so you see the result straight away. */
function liveEdit(ui: UiState, client: TableClient) {
  const pick = (match: (x: Drawing) => boolean) =>
    [...ui.data.drawSel].map((id) => client.scene?.draws.get(id)).filter((x): x is Drawing => !!x && x.k !== 'terrain' && client.canEditDrawing(x) && match(x));
  return {
    count: (match: (x: Drawing) => boolean) => pick(match).length,
    apply(match: (x: Drawing) => boolean, patch: Parameters<TableClient['updateDrawings']>[1]) {
      const ids = pick(match).map((x) => x.id);
      if (ids.length) void client.updateDrawings(ids, patch);
    },
  };
}

export function DrawFlyout(props: { ui: UiState; client: TableClient }) {
  const { ui, client } = props;
  const d = useUi(ui);
  const tool = TOOLS.find((t) => t.id === d.drawTool) ?? TOOLS[0];
  const allowed = client.canDo('draw');
  const closed = d.drawTool === 'rect' || d.drawTool === 'ellipse';
  const isText = d.drawTool === 'text';
  const wide = d.drawTool !== 'erase';
  // the drawing that is still selected after you draw it follows these controls as you change them
  const live = liveEdit(ui, client);
  const nSel = live.count((x) => x.hz == null && !isTemplate(x.k));
  return (
    <div class="flyout">
      <div class="flyout-title">Draw</div>
      {!allowed && <p class="hint">Drawing is turned off for players.</p>}
      <div class="seg wrap">
        {TOOLS.map((t) => <button key={t.id} class={d.drawTool === t.id ? 'on' : ''} onClick={() => ui.set({ drawTool: t.id })}>{t.label}</button>)}
      </div>
      {wide && <Colors value={d.drawColor} onPick={(c) => { ui.set({ drawColor: c }); live.apply((x) => x.hz == null && !isTemplate(x.k), { color: c }); }} />}
      {wide && (
        <div class="seg">
          {(['thin', 'medium', 'thick'] as StrokeSize[]).map((s) => <button key={s} class={d.drawSize === s ? 'on' : ''} onClick={() => { ui.set({ drawSize: s }); live.apply((x) => x.k === 'text', { fs: Math.round(client.grid.cell * (s === 'thin' ? 0.32 : s === 'thick' ? 0.7 : 0.45)) }); live.apply((x) => x.hz == null && x.k !== 'text' && !isTemplate(x.k), { w: Math.max(1.5, STROKE_CELLS[s] * client.grid.cell) }); }}>{isText ? (s === 'thin' ? 'Small' : s === 'medium' ? 'Medium' : 'Large') : s === 'thin' ? 'Thin' : s === 'medium' ? 'Medium' : 'Thick'}</button>)}
        </div>
      )}
      {closed && <FillControls mode={d.drawFillMode} color={d.drawFillColor} outline={d.drawColor} onMode={(m) => { ui.set({ drawFillMode: m }); live.apply((x) => x.hz == null && (x.k === 'rect' || x.k === 'ellipse'), { fill: FILL_LEVEL[m] }); }} onColor={(c) => { ui.set({ drawFillColor: c }); live.apply((x) => x.hz == null && (x.k === 'rect' || x.k === 'ellipse'), { fc: c }); }} />}
      {isText && (
        <div class="row wrap">
          <FontSelect value={d.textFont} onChange={(k) => { ui.set({ textFont: k }); live.apply((x) => x.k === 'text', { font: k }); }} />
          <StyleButtons b={d.textBold} i={d.textItalic} u={d.textUnderline} onB={(v) => { ui.set({ textBold: v }); live.apply((x) => x.k === 'text', { b: v }); }} onI={(v) => { ui.set({ textItalic: v }); live.apply((x) => x.k === 'text', { i: v }); }} onU={(v) => { ui.set({ textUnderline: v }); live.apply((x) => x.k === 'text', { u: v }); }} />
        </div>
      )}
      {wide && !isText && <Toggle checked={d.drawDash} onChange={(v) => { ui.set({ drawDash: v }); live.apply((x) => x.hz == null && x.k !== 'text' && !isTemplate(x.k), { dash: v }); }} label="Dashed" />}
      {nSel > 0 && <p class="hint">{nSel === 1 ? 'Your last drawing is still selected: changes here apply to it too.' : `${nSel} drawings are still selected: changes here apply to them too.`}</p>}
      <p class="hint">{tool.hint}</p>
      <div class="row wrap">
        <button class="btn small" onClick={async () => { const n = await client.clearDrawings((x) => x.uid === client.uid && !isTemplate(x.k) && x.hz == null && x.k !== 'terrain', 'Clear my drawings'); toast(n ? `Cleared ${n} drawing${n > 1 ? 's' : ''}` : 'Nothing of yours to clear', 'info', 1800); }}>Clear mine</button>
        {client.isDM && <button class="btn small danger" onClick={async () => { const n = await client.clearDrawings((x) => !isTemplate(x.k) && x.hz == null && x.k !== 'terrain', 'Clear all drawings'); toast(n ? `Cleared ${n} drawing${n > 1 ? 's' : ''}` : 'No drawings to clear', 'info', 1800); }}>Clear all</button>}
      </div>
    </div>
  );
}

const BRUSH_SIZES = [1, 2, 3, 4, 6, 8];

export function HeightFlyout(props: { ui: UiState; client: TableClient; onFromColor?: () => void }) {
  const { ui, client } = props;
  const d = useUi(ui);
  useClient(client);
  const grid = client.grid;
  const hex = isHex(grid);
  const gridless = currentOverlay(grid) === 'none';
  const mode = terrainBrushMode(d, gridless);
  const cellWord = hex ? 'hex' : 'square';
  const terrain = zonesOf(client.drawingsSorted(), grid);
  const sel = areasSelected(terrain, d.drawSel);
  const mine = sel.filter((a) => a.ids.every((id) => { const x = client.scene?.draws.get(id); return !x || client.canEditDrawing(x); }));
  const paintable = mine.filter((a) => !a.legacy);
  const one = mine.length === 1 ? mine[0] : null;
  const editing = mine.length > 0;
  // the number box shows the selected area (and edits it), or else what the next area will be
  const shownH = editing ? mine[0].h : d.heightFt;
  const shownAdd = editing ? paintable.length > 0 && paintable[0].add : d.heightAdds;
  const setH = (h: number) => {
    const n = Math.max(-1000, Math.min(5000, Math.round(h)));
    ui.set({ heightFt: n });
    for (const a of mine) void client.setArea(a, { hz: n });
  };
  const setAdds = (v: boolean) => {
    ui.set({ heightAdds: v });
    if (v && mode === 'paint') {
      ui.selectDrawings([]);
      return;
    }
    for (const a of paintable) void client.setArea(a, { ha: v });
  };
  const n = terrain.areas.length;
  const rough = d.groundKind === 'rough';
  const day = d.groundKind === 'day';
  const layer = rough || day;
  const dayN = dayOf(client.drawingsSorted(), grid).areas.length;
  const ambient = client.scene?.meta?.light.ambient ?? 'bright';
  const roughN = roughOf(client.drawingsSorted(), grid).areas.length;
  const modes = layer ? ([['paint', 'Paint'], ['erase', 'Erase']] as const) : ([['paint', 'Paint'], ['ramp', 'Ramp'], ['erase', 'Erase'], ['move', 'Select']] as const);
  const cliff = client.scene?.meta?.cliff ?? 10;
  return (
    <div class="flyout">
      <div class="flyout-title">Heights</div>
      <div class="seg">
        {([['height', 'Heights'], ['rough', 'Difficult'], ['day', 'Daylight']] as const).map(([k, label]) => (
          <button key={k} class={d.groundKind === k ? 'on' : ''} onClick={() => ui.set({ groundKind: k })}>{label}</button>
        ))}
      </div>
      {rough && <p class="hint">Walking through difficult ground costs double movement. Flyers are not slowed.</p>}
      {day && <p class="hint">The sun lights this ground even when the scene is dim or dark.{ambient === 'bright' && ' Set the scene light to Dim or Dark to see it.'}</p>}
      <div class="seg">
        {modes.filter(([k]) => !gridless || k !== 'ramp').map(([k, label]) => (
          <button key={k} class={mode === k ? 'on' : ''} onClick={() => ui.set({ heightMode: k })}>{label}</button>
        ))}
      </div>
      {!layer && mode === 'paint' && props.onFromColor && <button class="btn small" title="Pick a colour on the map picture (water, a pit) and paint every place with it at a height" onClick={props.onFromColor}>Paint height from a colour…</button>}
      {mode !== 'move' && (
        <>
          {!gridless && mode !== 'ramp' && <Toggle checked={d.heightSnap} onChange={(v) => ui.set({ heightSnap: v })} label={`Fill whole ${cellWord}s`} hint="Hold Alt to flip this for one stroke." />}
          <span class="field-label">{gridless ? 'Brush diameter (ft)' : mode === 'ramp' ? `Ramp width (${cellWord}s)` : `Brush size (${d.heightSnap ? `${cellWord}s across` : 'cells wide'})`}</span>
          <div class="chips">
            {BRUSH_SIZES.map((x) => <button key={x} class={`chip ${d.heightBrush === x ? 'on' : ''}`} onClick={() => ui.set({ heightBrush: x })}>{gridless ? x * grid.ft : x}</button>)}
          </div>
        </>
      )}
      {rough && (
        <div class="row wrap">
          <span class="hint">{roughN ? 'Difficult ground is on this map' : 'No difficult ground yet'}</span>
          <span class="grow" />
          {roughN > 0 && <button class="btn small danger" onClick={async () => { const c = await client.clearDrawings((x) => !!x.dt, 'Clear difficult ground'); toast(c ? 'Cleared the difficult ground' : 'Nothing to clear', 'info', 1800); }}>Clear difficult ground</button>}
        </div>
      )}
      {day && (
        <div class="row wrap">
          <span class="hint">{dayN ? 'Daylight is on this map' : 'No daylight yet'}</span>
          <span class="grow" />
          {dayN > 0 && <button class="btn small danger" onClick={async () => { const c = await client.clearDrawings((x) => !!x.dl, 'Clear daylight'); toast(c ? 'Cleared the daylight' : 'Nothing to clear', 'info', 1800); }}>Clear daylight</button>}
        </div>
      )}
      {!layer && mode === 'ramp' && (
        <div class="ht-card">
          <strong>Ramp</strong>
          <NumField label="Start" value={d.rampFrom} min={-1000} max={5000} step={5} unit="ft" title="How high the ground is where you press the mouse button" onCommit={(v) => ui.set({ rampFrom: Math.round(v) })} />
          <NumField label="End" value={d.rampTo} min={-1000} max={5000} step={5} unit="ft" title="How high the ground is where you let go" onCommit={(v) => ui.set({ rampTo: Math.round(v) })} />
          <div class="row wrap">
            <button class="btn small" onClick={() => ui.set({ rampFrom: d.rampTo, rampTo: d.rampFrom })}>Swap</button>
            <span class="hint">Drag from the start to the end. The ground climbs in 5 ft steps a token can walk up.</span>
          </div>
        </div>
      )}
      {!layer && mode !== 'ramp' && <div class="ht-card">
        <div class="row">
          <strong>{editing ? (one ? 'Selected ground' : `${mine.length} areas selected`) : 'Next ground you paint'}</strong>
          <span class="grow" />
          {editing && <button class="btn small" title="Let go of this ground so the next stroke starts a new one (Esc)" onClick={() => ui.selectDrawings([])}>New area</button>}
        </div>
        <NumField label={shownAdd ? 'Raise by' : 'Height'} value={shownH} min={-1000} max={5000} step={5} unit="ft" title={shownAdd ? 'How much higher this makes the ground it sits on. Negative digs it down.' : 'How high this ground is. Negative is a pit.'} onCommit={setH} />
        <div class="chips">
          {ZONE_PRESETS.map((h) => (
            <button key={h} class={`chip ${shownH === h ? 'on' : ''}`} style={{ borderColor: zoneColor(h) }} onClick={() => setH(h)}>{h}</button>
          ))}
        </div>
        <div class="seg">
          <button class={!shownAdd ? 'on' : ''} disabled={editing && !paintable.length} title="This ground is exactly this high above the map base, whatever is under it" onClick={() => setAdds(false)}>Exact height</button>
          <button class={shownAdd ? 'on' : ''} disabled={mode !== 'paint' && editing && !paintable.length} title="Each new stroke adds its height to the ground beneath it" onClick={() => setAdds(true)}>Added on top</button>
        </div>
        {editing ? (
          <div class="row wrap">
            {paintable.length > 1 && <button class="btn small" title="Make these one area" onClick={() => void client.mergeAreas(paintable)}>Merge</button>}
            <button class="btn small danger" onClick={() => { void client.removeDrawings(mine.flatMap((a) => a.ids), 'Delete ground'); ui.selectDrawings([]); }}>Delete {one ? 'area' : 'areas'}</button>
          </div>
        ) : <p class="hint">{shownAdd ? 'Each separate stroke raises or lowers the ground once.' : 'Strokes join into one area until you press New area or Esc.'}</p>}
      </div>}
      {!layer && (
        <p class="hint">
          {mode === 'paint' && 'Paint or drag across the map. Ctrl-click an area to select it, then paint more onto it or change its height.'}
          {mode === 'erase' && (editing ? 'Erases from the selected area only.' : 'Erases from every area. Select an area first to erase from just that one.')}
          {mode === 'move' && (gridless ? 'Click an area to select it and change its height. Drag it to move it freely. Shift-click adds more.' : `Click an area to select it and change its height. Drag it to move it: ground made of whole ${cellWord}s moves a ${cellWord} at a time (Alt moves it freely). Shift-click adds more.`)}
        </p>
      )}
      {layer && <p class="hint">{mode === 'paint' ? 'Paint or drag across the map.' : `Erases ${day ? 'daylight' : 'difficult ground'} wherever you drag.`}</p>}
      {!layer && client.isDM && (
        <div style={{ margin: '8px 0' }}>
          <NumField label="Steepest climb" value={cliff} min={0} max={1000} step={5} unit="ft" title="At 10 ft, ground that rises more than 10 ft within 10 horizontal feet is a cliff and stops a walker. This includes overlapping brushes. A single 5 ft step is walkable. The distance sideways scales with this number. Set to 0 to turn off automatic cliffs."
            onCommit={(v) => void client.updateScene({ cliff: Math.max(0, Math.round(v)) })} />
          <p class="hint">Ground that rises more than this is a cliff: walkers can't climb it, but can walk down. 0 turns cliffs off.</p>
        </div>
      )}
      <span class="field-label">Show the ground heights</span>
      <div class="seg">
        {([['auto', 'When moving'], ['always', 'Always'], ['tool', 'In tool']] as const).map(([k, label]) => (
          <button key={k} class={d.heightView === k ? 'on' : ''} onClick={() => ui.set({ heightView: k })}>{label}</button>
        ))}
      </div>
      <p class="hint">{d.heightView === 'auto' ? 'Shown while you drag a token or measure.' : d.heightView === 'always' ? 'Always shown.' : 'Shown only while this tool is open.'} Only on your screen.</p>
      <div class="row wrap">
        <span class="hint">{n ? `${n} height area${n > 1 ? 's' : ''} on this map` : 'No height areas yet'}</span>
        <span class="grow" />
        {n > 0 && <button class="btn small danger" onClick={async () => { const c = await client.clearDrawings((x) => !x.dt && !x.dl && (x.hz != null || x.k === 'terrain'), 'Clear all heights'); ui.selectDrawings([]); toast(c ? `Cleared the height areas` : 'No heights to clear', 'info', 1800); }}>Clear all heights</button>}
      </div>
    </div>
  );
}

const WALL_HINT: Record<WallKind, string> = {
  wall: 'Stops sight, movement and spells.',
  door: 'Blocks everything while it is closed. Click its diamond to open it.',
  window: 'You can see and cast through it. Shut, nobody walks through; click its square to open it.',
};

const SHAPE_HINT = { line: 'One wall at a time, run on from point to point', box: 'A room: four walls at once', free: 'Draw a line by hand', circle: 'A round room' } as const;

export function WallFlyout(props: { ui: UiState; client: TableClient; onDetect?: () => void }) {
  const { ui, client } = props;
  const d = useUi(ui);
  useClient(client);
  const meta = client.scene?.meta;
  const walls = client.wallsList();
  const sel = [...d.wallSel].map((id) => client.scene?.walls.get(id)).filter((w): w is NonNullable<typeof w> => !!w);
  const ids = sel.map((w) => w.id);
  const doors = sel.filter((w) => w.k !== 'wall');
  const openWord = doors.length && doors.every((w) => w.k === 'window') ? 'window' : doors.every((w) => w.k === 'door') ? 'door' : 'door or window';
  const canOne = sel.filter((w) => w.k !== 'door');
  const kinds = new Set(sel.map((w) => w.k));
  const allVis = sel.length > 0 && sel.every((w) => w.vis);
  const shownVis = d.wallVis ?? wallVisDefault(d.wallKind);
  const sightOn = !!meta?.fog.enabled && !!meta?.fog.vision;
  return (
    <div class="flyout">
      <div class="flyout-title">Walls</div>
      <div class="seg">
        {([['draw', 'Draw'], ['edit', 'Edit']] as const).map(([k, label]) => <button key={k} class={d.wallMode === k ? 'on' : ''} onClick={() => ui.set({ wallMode: k, wallSel: new Set() })}>{label}</button>)}
      </div>
      {d.wallMode === 'draw' ? (
        <>
          <div class="seg">
            {WALL_KINDS.map((k) => <button key={k} class={d.wallKind === k ? 'on' : ''} title={WALL_HINT[k]} onClick={() => ui.set({ wallKind: k, wallVis: null })}>{WALL_NAME[k]}</button>)}
          </div>
          <p class="hint">{WALL_HINT[d.wallKind]}</p>
          <Toggle checked={shownVis} onChange={(v) => ui.set({ wallVis: v })} label="Players can see it" hint="Off: only you see it. It blocks either way." />
          {d.wallKind !== 'door' && (
            <>
              <span class="field-label">Shape</span>
              <div class="seg wrap">
                {([['line', 'Lines'], ['box', 'Box'], ['free', 'Freehand'], ['circle', 'Round']] as const).map(([k, label]) => (
                  <button key={k} class={d.wallShape === k ? 'on' : ''} title={SHAPE_HINT[k]} onClick={() => ui.set({ wallShape: k })}>{label}</button>
                ))}
              </div>
              {(d.wallShape === 'free' || d.wallShape === 'circle') && (
                <>
                  <span class="field-label">Corners</span>
                  <div class="seg">
                    {([['low', 'Few'], ['mid', 'Some'], ['high', 'Many']] as const).map(([k, label]) => <button key={k} class={d.wallDetail === k ? 'on' : ''} onClick={() => ui.set({ wallDetail: k })}>{label}</button>)}
                  </div>
                </>
              )}
              <Toggle checked={d.wallOne !== 0} onChange={(v) => ui.set({ wallOne: v ? (d.wallOne || 1) : 0 })} label="One-way (a cliff edge)"
                hint="Blocks from one side only. The little ticks mark the side that is stopped." />
              {d.wallOne !== 0 && (
                <div class="seg">
                  <button class={d.wallOne === 1 ? 'on' : ''} title="The side on your right as you draw from the first point to the next" onClick={() => ui.set({ wallOne: 1 })}>Stops its right</button>
                  <button class={d.wallOne === -1 ? 'on' : ''} title="The side on your left as you draw from the first point to the next" onClick={() => ui.set({ wallOne: -1 })}>Stops its left</button>
                </div>
              )}
            </>
          )}
<div>
            <NumField label="Height" value={d.wallH} min={0} max={1000} step={5} unit="ft" title="How tall it is above the ground it stands on. 0 means too tall to get over. Anything higher than the top sees and flies over it." onCommit={(n) => ui.set({ wallH: Math.max(0, Math.round(n)) })} />
            {d.wallH === 0 && <span class="hint"> 0: full height, nothing gets over it</span>}
          </div>
          <span class="field-label">Snap ends to</span>
          <div class="seg wrap">
            {([['corner', 'Corners'], ['half', 'Halves too'], ['off', 'Free']] as const).map(([k, label]) => <button key={k} class={d.wallSnap === k ? 'on' : ''} onClick={() => ui.set({ wallSnap: k })}>{label}</button>)}
          </div>
          {props.onDetect && <button class="btn small" title="Look for the walls printed on the map picture and add them for you to check" onClick={props.onDetect}>Detect walls from the map…</button>}
          <p class="hint">
            {d.wallKind === 'door' || d.wallShape === 'line' ? 'Click points and the walls run on; double-click, Enter, Esc or right-click to stop. Or drag one wall at a time.'
              : d.wallShape === 'box' ? 'Drag out a room, or click two opposite corners.'
              : d.wallShape === 'circle' ? 'Drag from the middle out to the edge, or click the middle and then the edge.'
              : 'Draw the outline with the mouse held down. Come back to where you started to close it. It becomes ordinary walls you can bend afterwards.'}
            {' '}Shift: straight or 45°. Alt: no snapping.{d.wallKind !== 'wall' ? ' Drawn along a wall, it cuts a gap in it.' : ''}
          </p>
        </>
      ) : (
        <div class="ht-card">
          <div class="row">
            <strong>{sel.length ? (sel.length === 1 ? `Selected ${WALL_NAME[sel[0].k].toLowerCase()}` : `${sel.length} walls selected`) : 'Nothing selected'}</strong>
            <span class="grow" />
            {walls.length > sel.length && <button class="btn small" onClick={() => ui.set({ wallSel: new Set(walls.map((w) => w.id)) })}>Select all</button>}
          </div>
          {sel.length > 0 ? (
            <>
              <div class="seg">
                {WALL_KINDS.map((k) => <button key={k} class={kinds.size === 1 && kinds.has(k) ? 'on' : ''} onClick={() => void client.updateWalls(ids, { k }, 'Change wall type')}>{WALL_NAME[k]}</button>)}
              </div>
              <Toggle checked={allVis} onChange={(v) => void client.updateWalls(ids, { vis: v }, v ? 'Show wall to players' : 'Hide wall from players')} label="Players can see it" />
              {canOne.length > 0 && (
                <>
                  <Toggle checked={canOne.every((w) => w.one !== 0)} onChange={(v) => void client.updateWalls(canOne.map((w) => w.id), { one: v ? 1 : 0 }, v ? 'Make one-way' : 'Make two-way')} label="One-way (a cliff edge)"
                    hint="Stops only what is on the ticked side." />
                  {canOne.some((w) => w.one !== 0) && <button class="btn small" title="Swap which side is stopped (X)" onClick={() => void client.flipWalls(ids)}>Flip the stopped side (X)</button>}
                </>
              )}
              <div>
                <NumField label="Height" value={sel[0].h} min={0} max={1000} step={5} unit="ft" title="How tall above the ground it stands on. 0 means too tall to get over. Anything higher than the top sees and flies over it."
                  onCommit={(n) => void client.updateWalls(ids, { h: Math.max(0, Math.round(n)) }, 'Change wall height')} />
                {sel[0].h === 0 && <span class="hint"> 0: full height</span>}
              </div>
              {doors.length > 0 && (
                <div class="seg">
                  <button class={doors.every((w) => !w.open) ? 'on' : ''} onClick={() => void client.updateWalls(doors.map((w) => w.id), { open: false }, `Close ${openWord}`)}>Closed</button>
                  <button class={doors.every((w) => w.open) ? 'on' : ''} onClick={() => void client.updateWalls(doors.map((w) => w.id), { open: true }, `Open ${openWord}`)}>Open</button>
                </div>
              )}
              <div class="row wrap">
                <button class="btn small danger" onClick={() => { void client.removeWalls(ids); ui.set({ wallSel: new Set() }); }}>Delete {sel.length > 1 ? 'walls' : WALL_NAME[sel[0].k].toLowerCase()}</button>
              </div>
            </>
          ) : <p class="hint">Click a wall, or drag a box round several (Shift-click adds more). Drag a dot to move a corner, or the wall to move it. Double-click a wall to add a corner, a corner to remove it, a door or window to open it.</p>}
        </div>
      )}
      <div class="ht-card">
        <button type="button" class="fold-head" aria-expanded={d.wallMapOpen} onClick={() => ui.set({ wallMapOpen: !d.wallMapOpen })}>
          <span class="fold-caret" aria-hidden="true">{d.wallMapOpen ? '▾' : '▸'}</span>
          <strong>On this map</strong>
        </button>
        {d.wallMapOpen && (
          <>
            <Toggle checked={!!meta?.wallStop} onChange={(v) => void client.updateScene({ wallStop: v })} label="Walls stop the players' tokens" hint="Off: walls only block sight and spells." />
            <Toggle checked={d.wallIgnore} onChange={(v) => ui.set({ wallIgnore: v })} label="DM can move tokens through walls" hint="Holding Q while you drag does it once." />
            <Toggle checked={d.showWalls} onChange={(v) => ui.set({ showWalls: v })} label="Show walls when this tool is closed" hint="Only on your screen." />
          </>
        )}
        {!sightOn && (
          <button class="btn small" onClick={() => void client.updateScene({ fog: { enabled: true, vision: true } })}>Turn on fog and token sight</button>
        )}
      </div>
      <div class="row wrap">
        <span class="hint">{walls.length ? `${walls.length} wall${walls.length > 1 ? 's' : ''} on this map` : 'No walls yet'}</span>
        <span class="grow" />
        {walls.length > 0 && <button class="btn small danger" onClick={async () => { await client.removeWalls(walls.map((w) => w.id)); ui.set({ wallSel: new Set() }); toast('Cleared all the walls (Ctrl+Z brings them back)', 'info', 2200); }}>Clear all walls</button>}
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
      {!client.canDo('template') && <p class="hint">Placing templates is turned off for players.</p>}
      <div class="seg" role="group" aria-label="What a click does">
        {([['place', 'Place'], ['select', 'Select']] as const).map(([k, label]) => (
          <button key={k} class={d.tplMode === k ? 'on' : ''} onClick={() => ui.set({ tplMode: k, ...(k === 'place' ? { drawSel: new Set<string>() } : {}) })}>{label}</button>
        ))}
      </div>
      {d.tplMode === 'select' ? (
        <p class="hint">Click a template to pick it (Shift adds more). Drag it to move it a square at a time (Alt: freely), drag its dots to resize it, or press Delete.</p>
      ) : <>
      <div class="seg wrap">
        {TEMPLATES.map((x) => <button key={x.id} class={d.tplKind === x.id ? 'on' : ''} onClick={() => ui.set({ tplKind: x.id })}>{x.label}</button>)}
      </div>
      <Colors value={d.drawColor} onPick={(c) => { ui.set({ drawColor: c }); liveEdit(ui, client).apply((x) => isTemplate(x.k), { color: c }); }} />
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
      <Toggle checked={d.tplRough} onChange={(v) => ui.set({ tplRough: v })} label="Counts as difficult ground" hint="For templates you place next: tokens pay extra to move through them." />
      <Toggle checked={d.tplShare} onChange={(v) => ui.set({ tplShare: v })} label="Show others my templates" hint="Off: only you and the DM see them." />
      <Toggle checked={d.tplCover} onChange={(v) => ui.set({ tplCover: v })} label={hex ? 'Show the hexes it covers' : 'Show the squares it covers'} hint={hex ? 'A hex counts when its middle is inside the area.' : 'A square counts when its middle is inside the area.'} />
      <p class="hint">{say(t.hint)} {say('Sizes snap to whole squares')} (hold Alt to turn that off, Shift to lock the angle).</p>
      </>}
      <div class="row wrap">
        <button class="btn small" onClick={async () => { const n = await client.clearDrawings((x) => isTemplate(x.k), 'Clear templates'); ui.selectDrawings([]); toast(n ? `Cleared ${n} template${n > 1 ? 's' : ''}` : 'No templates to clear', 'info', 1800); }}>
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
      <p class="hint">Drag to measure. Alt: measure freely, off the grid. Right-click or Esc clears it.</p>
      <Toggle checked={d.rulerMulti} onChange={(v) => ui.set({ rulerMulti: v })} label="Measure in several steps"
        hint="Each drag carries on from the last. Right-click takes back a step; Shift+drag starts again." />
      <span class="field-label">Colour</span>
      <Colors value={d.rulerColor} fallback={mine} sameLabel="Use my player colour" onPick={(c) => ui.set({ rulerColor: c })} />
      <Toggle checked={d.sharePlot} onChange={(v) => ui.set({ sharePlot: v })} label="Show my ruler to everyone" />
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
      <span class="muted small">{d.testCount ? `${d.testCount} moved` : 'Drag a token to try a move'}</span>
      <label class="toggle small" title="Each drag adds a step to the move instead of replacing it. Right-click goes back one step.">
        <input type="checkbox" checked={d.testMulti} onChange={(e) => ui.set({ testMulti: (e.target as HTMLInputElement).checked })} />
        <span class="toggle-text">Multi-step</span>
      </label>
      <button class="btn small primary" disabled={!d.testCount} onClick={() => board?.keepTestMoves()} title="Make the move for real (Enter)">Keep</button>
      <button class="btn small" disabled={!d.testCount} onClick={() => board?.stepBackTest()} title="Go back one step (right-click)">Back</button>
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
  // painted ground is edited in the Heights panel, not here
  const list = [...d.drawSel].map((id) => client.scene?.draws.get(id)).filter((x): x is Drawing => !!x && x.k !== 'terrain' && client.canEditDrawing(x));
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
                <button key={h} class={`chip ${first.hz === h ? 'on' : ''}`} style={{ borderColor: zoneColor(h) }} onClick={() => upd({ hz: h, color: zoneColor(h), fc: zoneColor(h) })}>{h}</button>
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
          <>
            <label class="field"><span class="field-label">Opacity</span>
              <input type="range" min={10} max={100} value={Math.round((first.fill || 0.28) * 100)} onInput={(e) => upd({ fill: Number((e.target as HTMLInputElement).value) / 100 })} /></label>
            <Toggle checked={list.every((x) => !!x.td)} onChange={(v) => upd({ td: v })} label="Difficult ground" hint="Moving through it costs extra while it is here." />
          </>
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
