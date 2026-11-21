import { useEffect, useRef, useState } from 'preact/hooks';
import { canvasToBlob, loadImage } from '../core/images';
import { selectionPixels, sensitivityForDrag, unionMask, wandSelect } from '../core/wand';
import type { TokenShape } from '../types';

const STAGE = 300; // px, the square drag area
const FRAME = 200; // px, the token's diameter inside it

export interface Framing { imgScale: number; imgX: number; imgY: number }
export const NO_FRAMING: Framing = { imgScale: 1, imgX: 0, imgY: 0 };

const px = (n: number) => `${n}px`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

const canDrop = typeof window !== 'undefined' && typeof (window as any).EyeDropper === 'function';

/** A colour box with a "pick from anywhere on screen" dropper next to it. */
export function ColorPick(props: { value: string; onChange: (hex: string) => void; label?: string; onClear?: () => void }) {
  return (
    <span class="colorpick">
      <input type="color" value={props.value} title={props.label} onInput={(e) => props.onChange((e.target as HTMLInputElement).value)} />
      <button class="btn small" disabled={!canDrop} title={canDrop ? 'Pick a colour from anywhere on the screen' : "This browser can't pick colours from the screen. Use the colour box."}
        onClick={async () => { try { const r = await new (window as any).EyeDropper().open(); props.onChange(r.sRGBHex); } catch { /* cancelled */ } }}>Dropper</button>
      {props.onClear && <button class="btn small" onClick={props.onClear}>Clear</button>}
    </span>
  );
}

/** What the editors need from the paint layer when saving. */
export interface PaintApi {
  /** True once anything was painted or cut out of the picture (so the picture has to be re-saved). */
  hasPaint(): boolean;
  /** Merge the framed picture and the paint into one square PNG. */
  bake(src: string | null, framing: Framing, shape: TokenShape): Promise<Blob>;
}

const PAINT_SIZE = 512;
type Mode = 'move' | 'paint' | 'erasePaint' | 'eraseImage' | 'wand';
type Snap = { layer: 'paint' | 'erase'; data: ImageData };

const ctx2 = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
const mkCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = PAINT_SIZE; return c; };

/** Draw the picture into the 512 square the same way the framing shows it on screen. */
function drawFramed(ctx: CanvasRenderingContext2D, img: HTMLImageElement, framing: Framing, shape: TokenShape) {
  const fitK = shape === 'none' ? Math.min(PAINT_SIZE / img.naturalWidth, PAINT_SIZE / img.naturalHeight) : Math.max(PAINT_SIZE / img.naturalWidth, PAINT_SIZE / img.naturalHeight);
  const w = img.naturalWidth * fitK * framing.imgScale;
  const h = img.naturalHeight * fitK * framing.imgScale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, PAINT_SIZE / 2 + framing.imgX * PAINT_SIZE - w / 2, PAINT_SIZE / 2 + framing.imgY * PAINT_SIZE - h / 2, w, h);
}

/** A small "choose a picture" button that hands back the chosen file. */
export function PickImage(props: { label: string; onFile: (f: File) => void; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden
        onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) props.onFile(f); (e.target as HTMLInputElement).value = ''; }} />
      <button class="btn small" disabled={props.disabled} onClick={() => ref.current?.click()}>{props.label}</button>
    </>
  );
}

/**
 * Token picture framing: drag the picture to move it, scroll (or use the slider) to zoom.
 * The bright area inside the outline is what ends up on the token; the dim area is cropped away.
 * The framing is stored as zoom + offset, so the original picture is never changed.
 */
export function TokenCropper(props: {
  src: string | null;
  shape: TokenShape;
  ring: string;
  ringW: number;
  name: string;
  framing: Framing;
  onChange: (f: Framing) => void;
  disabled?: boolean;
  /** colour behind the picture inside the token shape */
  bg: string | null;
  onBg: (c: string | null) => void;
  /** filled in with the paint layer's save helpers */
  paintApi?: { current: PaintApi | null };
  /** called when the painting changes (so a Save button can light up) */
  onPaint?: () => void;
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const fr = useRef(props.framing);
  fr.current = props.framing;
  const [mode, setMode] = useState<Mode>('move');
  const [brush, setBrush] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(36);
  const [sens, setSens] = useState(25);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const layerRef = useRef<HTMLCanvasElement>(null);
  const selCanvas = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const painting = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const snaps = useRef<Snap[]>([]);
  const dirtyPaint = useRef(false);
  const dirtyErase = useRef(false);
  const [erased, setErased] = useState(false);
  const [paintTick, setPaintTick] = useState(0);
  // the picture as a canvas-readable image (needed for cutting parts out of it and for the wand)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [imgErr, setImgErr] = useState(false);
  // off-screen canvases: the cut-out mask, the clip made from the selection, a scratch layer and a copy for the wand to read
  const offs = useRef<{ erase: HTMLCanvasElement; clip: HTMLCanvasElement; tmp: HTMLCanvasElement; base: HTMLCanvasElement } | null>(null);
  const off = () => (offs.current ??= { erase: mkCanvas(), clip: mkCanvas(), tmp: mkCanvas(), base: mkCanvas() });
  // magic wand
  const sel = useRef<Uint8Array | null>(null);
  const inverted = useRef(false);
  const [selUi, setSelUi] = useState({ on: false, inv: false });
  const wand = useRef<{ data: Uint8ClampedArray | null; seed: { x: number; y: number } | null; cx: number; cy: number; moved: boolean; active: boolean; prev: Uint8Array | null }>(
    { data: null, seed: null, cx: 0, cy: 0, moved: false, active: false, prev: null });

  const brushMode = mode === 'paint' || mode === 'erasePaint' || mode === 'eraseImage';
  const needsImg = mode === 'eraseImage' || mode === 'wand';
  const imgReady = !!props.src && !!imgEl;

  const paintPoint = (e: { clientX: number; clientY: number }) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAINT_SIZE, y: ((e.clientY - r.top) / r.height) * PAINT_SIZE };
  };
  const pushSnap = (layer: 'paint' | 'erase') => {
    const c = layer === 'erase' ? off().erase : paintRef.current!;
    snaps.current.push({ layer, data: ctx2(c).getImageData(0, 0, PAINT_SIZE, PAINT_SIZE) });
    if (snaps.current.length > 20) snaps.current.shift();
  };

  /** The picture as it looks inside the frame, with any cut-out parts removed. */
  const renderBase = (c: HTMLCanvasElement) => {
    const ctx = ctx2(c);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    if (!imgEl) return ctx;
    drawFramed(ctx, imgEl, fr.current, props.shape);
    if (dirtyErase.current) { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(off().erase, 0, 0); ctx.globalCompositeOperation = 'source-over'; }
    return ctx;
  };
  const renderImageLayer = () => { if (layerRef.current) renderBase(layerRef.current); };

  /** One piece of brush stroke, kept inside the selection when there is one. */
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const target = ctx2(mode === 'eraseImage' ? off().erase : paintRef.current!);
    const colour = mode === 'paint' ? brush : '#000';
    const op: GlobalCompositeOperation = mode === 'erasePaint' ? 'destination-out' : 'source-over';
    const draw = (ctx: CanvasRenderingContext2D) => {
      ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      if (a.x === b.x && a.y === b.y) { ctx.beginPath(); ctx.arc(a.x, a.y, brushSize / 2, 0, Math.PI * 2); ctx.fill(); }
    };
    if (!sel.current) {
      target.globalCompositeOperation = op; draw(target); target.globalCompositeOperation = 'source-over';
      return;
    }
    const t = ctx2(off().tmp);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    draw(t);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(off().clip, 0, 0);
    t.globalCompositeOperation = 'source-over';
    target.globalCompositeOperation = op;
    target.drawImage(off().tmp, 0, 0);
    target.globalCompositeOperation = 'source-over';
  };
  const clearPaint = () => {
    const c = paintRef.current;
    if (!c) return;
    pushSnap('paint');
    ctx2(c).clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    dirtyPaint.current = false;
    setPaintTick((n) => n + 1);
  };
  const restoreImage = () => {
    pushSnap('erase');
    ctx2(off().erase).clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    dirtyErase.current = false;
    wand.current.data = null;
    setErased(false);
    setPaintTick((n) => n + 1);
  };
  const undoStroke = () => {
    const snap = snaps.current.pop();
    if (!snap) return;
    const c = snap.layer === 'erase' ? off().erase : paintRef.current!;
    ctx2(c).putImageData(snap.data, 0, 0);
    if (snap.layer === 'erase') {
      dirtyErase.current = hasPixels(c);
      wand.current.data = null;
      setErased(dirtyErase.current);
      renderImageLayer();
    } else {
      dirtyPaint.current = hasPixels(c);
    }
    setPaintTick((n) => n + 1);
  };

  /** Redraw the selection outline and the clip that keeps strokes inside it. */
  const refreshSelection = () => {
    const sc = selCanvas.current;
    const m = sel.current;
    if (!m) {
      if (sc) ctx2(sc).clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
      setSelUi({ on: false, inv: false });
      return;
    }
    const { clip, overlay } = selectionPixels(m, inverted.current, PAINT_SIZE, PAINT_SIZE);
    ctx2(off().clip).putImageData(new ImageData(clip, PAINT_SIZE, PAINT_SIZE), 0, 0);
    if (sc) ctx2(sc).putImageData(new ImageData(overlay, PAINT_SIZE, PAINT_SIZE), 0, 0);
    setSelUi({ on: true, inv: inverted.current });
  };
  const dropSelection = () => { sel.current = null; inverted.current = false; wand.current.prev = null; wand.current.seed = null; refreshSelection(); };
  const invertSelection = () => { if (!sel.current) return; inverted.current = !inverted.current; refreshSelection(); };

  const sampleBase = (): Uint8ClampedArray | null => {
    if (!imgEl) return null;
    return renderBase(off().base).getImageData(0, 0, PAINT_SIZE, PAINT_SIZE).data;
  };
  /** Run the wand from the remembered click with the given sensitivity. */
  const runWand = (tol: number) => {
    const w = wand.current;
    if (!w.seed) return;
    w.data ??= sampleBase();
    if (!w.data) return;
    const m = wandSelect(w.data, PAINT_SIZE, PAINT_SIZE, w.seed.x, w.seed.y, tol);
    sel.current = w.prev ? unionMask(w.prev, m) : m;
    refreshSelection();
  };

  const updateCursor = (e: { clientX: number; clientY: number }, show: boolean) => {
    const cur = cursorRef.current, st = stageRef.current;
    if (!cur || !st) return;
    if (!show) { cur.style.display = 'none'; return; }
    const r = st.getBoundingClientRect();
    cur.style.display = 'block';
    cur.style.transform = `translate(${e.clientX - r.left - st.clientLeft}px, ${e.clientY - r.top - st.clientTop}px) translate(-50%, -50%)`;
  };

  useEffect(() => {
    if (!props.paintApi) return;
    props.paintApi.current = {
      hasPaint: () => dirtyPaint.current || dirtyErase.current,
      bake: async (src, framing, shape) => {
        const c = document.createElement('canvas');
        c.width = c.height = PAINT_SIZE;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        if (src) {
          const img = await loadImage(src, true);
          drawFramed(ctx, img, framing, shape);
          if (dirtyErase.current) { ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(off().erase, 0, 0); ctx.globalCompositeOperation = 'source-over'; }
        }
        ctx.drawImage(paintRef.current!, 0, 0);
        return canvasToBlob(c, 'image/png');
      },
    };
    return () => { if (props.paintApi) props.paintApi.current = null; };
  }, [props.paintApi]);

  useEffect(() => {
    setNat(null);
    setImgEl(null);
    setImgErr(false);
    // a selection and cut-outs belong to one picture; a different picture starts fresh
    ctx2(off().erase).clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    dirtyErase.current = false;
    snaps.current = snaps.current.filter((s) => s.layer === 'paint');
    wand.current.data = null;
    setErased(false);
    dropSelection();
    if (!props.src) return;
    let dead = false;
    const im = new Image();
    im.onload = () => { if (!dead) setNat({ w: im.naturalWidth, h: im.naturalHeight }); };
    im.src = props.src;
    loadImage(props.src, true).then((i) => { if (!dead) setImgEl(i); }).catch(() => { if (!dead) setImgErr(true); });
    return () => { dead = true; };
  }, [props.src]);

  // keep the cut-out picture layer in step with the framing
  useEffect(() => {
    wand.current.data = null;
    if (erased) renderImageLayer();
  }, [erased, imgEl, props.shape, props.framing.imgScale, props.framing.imgX, props.framing.imgY]);

  useEffect(() => { updateCursor({ clientX: 0, clientY: 0 }, false); }, [mode]);

  const D = FRAME;
  const f = props.framing;
  const fit = nat ? (props.shape === 'none' ? Math.min(D / nat.w, D / nat.h) : Math.max(D / nat.w, D / nat.h)) : 1;
  const iw = nat ? nat.w * fit * f.imgScale : 0;
  const ih = nat ? nat.h * fit * f.imgScale : 0;
  const cx = f.imgX * D;
  const cy = f.imgY * D;
  const radius = props.shape === 'circle' ? '50%' : '0';
  const ringPx = props.shape === 'none' ? 0 : props.ringW * D;
  const canDrag = !!nat && !props.disabled;
  const showLayer = erased && !!imgEl;
  const cursorD = Math.max(4, (brushSize * D) / PAINT_SIZE);

  const setZoom = (z: number) => props.onChange({ ...fr.current, imgScale: clamp(z, 0.2, 8) });

  const stageCursor = mode === 'move' ? (canDrag ? undefined : 'default') : brushMode ? 'none' : 'crosshair';

  const onDown = (e: PointerEvent) => {
    if (props.disabled) return;
    const stage = e.currentTarget as HTMLElement;
    if (mode === 'wand') {
      const pt = paintPoint(e);
      if (!imgReady || pt.x < 0 || pt.y < 0 || pt.x >= PAINT_SIZE || pt.y >= PAINT_SIZE) return;
      stage.setPointerCapture(e.pointerId);
      const w = wand.current;
      w.data = null;
      w.seed = { x: Math.floor(pt.x), y: Math.floor(pt.y) };
      w.cx = e.clientX; w.cy = e.clientY; w.moved = false; w.active = true;
      w.prev = e.shiftKey && sel.current ? sel.current : null;
      if (!w.prev) inverted.current = false;
      runWand(sens);
      return;
    }
    if (mode === 'move') {
      if (!canDrag) return;
      stage.setPointerCapture(e.pointerId);
      drag.current = { px: e.clientX, py: e.clientY, x: fr.current.imgX, y: fr.current.imgY };
      setDragging(true);
      return;
    }
    if (mode === 'eraseImage' && !imgReady) return;
    stage.setPointerCapture(e.pointerId);
    pushSnap(mode === 'eraseImage' ? 'erase' : 'paint');
    painting.current = true;
    const pt = paintPoint(e);
    lastPt.current = pt;
    stroke(pt, pt);
    if (mode === 'paint') { dirtyPaint.current = true; props.onPaint?.(); }
    if (mode === 'eraseImage') { dirtyErase.current = true; setErased(true); renderImageLayer(); props.onPaint?.(); }
  };
  const onMove = (e: PointerEvent) => {
    updateCursor(e, brushMode);
    if (painting.current && lastPt.current) {
      const pt = paintPoint(e);
      stroke(lastPt.current, pt);
      lastPt.current = pt;
      if (mode === 'eraseImage') renderImageLayer();
      return;
    }
    const w = wand.current;
    if (w.active) {
      const dist = Math.hypot(e.clientX - w.cx, e.clientY - w.cy);
      if (!w.moved && dist < 4) return;
      w.moved = true;
      const t = sensitivityForDrag(dist);
      setSens(t);
      runWand(t);
      return;
    }
    const d = drag.current;
    if (!d) return;
    props.onChange({ ...fr.current, imgX: clamp(d.x + (e.clientX - d.px) / D, -3, 3), imgY: clamp(d.y + (e.clientY - d.py) / D, -3, 3) });
  };
  const onUp = () => {
    if (painting.current && mode === 'eraseImage') wand.current.data = null;
    drag.current = null; painting.current = false; lastPt.current = null; wand.current.active = false;
    setDragging(false); setPaintTick((n) => n + 1);
  };

  const modeBtn = (m: Mode, label: string, title: string, disabled = false) => (
    <button class={mode === m ? 'on' : ''} disabled={disabled} onClick={() => setMode(m)} title={title}>{label}</button>
  );
  const noEdit = props.disabled || !props.src;
  const hint =
    mode === 'move' ? 'Drag the picture to move it. Scroll to zoom.'
    : mode === 'paint' ? 'Paint sits on top of the picture and is saved into it.'
    : mode === 'erasePaint' ? 'Rubs out your paint. The picture underneath stays.'
    : mode === 'eraseImage' ? 'Cuts parts out of the picture itself. Place and zoom the picture first.'
    : 'Click a part of the picture to select it. Drag away from the click to select more, back toward it to select less. Shift-click adds to the selection.';

  return (
    <div class="cropper">
      <div
        ref={stageRef}
        class={`crop-stage ${dragging ? 'drag' : ''}`}
        style={{ cursor: stageCursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => { if (!painting.current) updateCursor({ clientX: 0, clientY: 0 }, false); }}
        onWheel={(e) => {
          if (!canDrag || mode !== 'move') return;
          e.preventDefault();
          setZoom(fr.current.imgScale * Math.exp(-e.deltaY * 0.0015));
        }}
      >
        {nat && props.src && props.shape !== 'none' && (
          <img class="dim" src={props.src} alt="" style={{ width: px(iw), height: px(ih), left: px(STAGE / 2 + cx - iw / 2), top: px(STAGE / 2 + cy - ih / 2) }} />
        )}
        <div ref={frameRef} class={`crop-frame ${props.shape}`} style={{ width: px(D), height: px(D), borderRadius: radius, overflow: props.shape === 'none' ? 'visible' : 'hidden', ...(props.bg ? { background: props.bg } : {}) }}>
          {nat && props.src
            ? <img src={props.src} alt="" style={{ width: px(iw), height: px(ih), left: px(D / 2 + cx - iw / 2), top: px(D / 2 + cy - ih / 2), ...(showLayer ? { display: 'none' } : {}) }} />
            : <div class="initial" style={{ background: props.bg ?? '#4b5366' }}>{(props.name || '?').trim().charAt(0).toUpperCase() || '?'}</div>}
          <canvas ref={layerRef} class="image-layer" width={PAINT_SIZE} height={PAINT_SIZE} style={{ display: showLayer ? 'block' : 'none' }} />
          <canvas ref={paintRef} class="paint-layer" width={PAINT_SIZE} height={PAINT_SIZE} />
          <canvas ref={selCanvas} class="sel-layer" width={PAINT_SIZE} height={PAINT_SIZE} style={{ display: selUi.on && mode !== 'move' ? 'block' : 'none' }} />
        </div>
        {ringPx > 0 && <div class="crop-ring" style={{ width: px(D), height: px(D), borderRadius: radius, borderWidth: px(ringPx), borderColor: props.ring }} />}
        <div ref={cursorRef} class="brush-cursor" style={{ width: px(cursorD), height: px(cursorD), display: 'none' }} />
      </div>
      {props.src ? (
        <div class="crop-tools">
          <span class="muted small">Zoom</span>
          <input type="range" min={0.2} max={5} step={0.01} value={Math.min(5, f.imgScale)} disabled={!canDrag} onInput={(e) => setZoom(Number((e.target as HTMLInputElement).value))} />
          <button class="btn small" disabled={!canDrag} onClick={() => props.onChange({ ...NO_FRAMING })}>Reset</button>
        </div>
      ) : (
        <div class="muted small">No picture yet. Add one, then drag it into place.</div>
      )}
      <div class="crop-tools stack-tools">
        <div class="seg wrap">
          {modeBtn('move', 'Move', 'Drag the picture around')}
          {modeBtn('paint', 'Paint', 'Paint over the token')}
          {modeBtn('erasePaint', 'Erase paint', 'Rub out your painting')}
          {modeBtn('eraseImage', 'Erase image', 'Cut parts out of the picture itself', noEdit || imgErr)}
          {modeBtn('wand', 'Wand', 'Select an area by colour, then paint or erase just inside it', noEdit || imgErr)}
        </div>
      </div>
      <div class="crop-tools brush-row">
        {mode !== 'move' && (
          <>
            {mode === 'paint' && <ColorPick value={brush} onChange={setBrush} label="Brush colour" />}
            {brushMode && <span class="muted small">Size</span>}
            {brushMode && <input type="range" min={4} max={140} value={brushSize} onInput={(e) => setBrushSize(Number((e.target as HTMLInputElement).value))} title="Brush size" />}
            {mode === 'wand' && (
              <>
                <span class="muted small" title="How different a colour can be and still be selected">Sensitivity</span>
                <input type="range" min={0} max={100} value={sens} title="Sensitivity" onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setSens(v); runWand(v); }} />
                <span class="small num">{sens}%</span>
              </>
            )}
            {brushMode && <button class="btn small" disabled={snaps.current.length === 0} onClick={undoStroke}>Undo stroke</button>}
            {(mode === 'paint' || mode === 'erasePaint') && <button class="btn small" onClick={clearPaint}>Clear paint</button>}
            {mode === 'eraseImage' && <button class="btn small" disabled={!erased} onClick={restoreImage}>Restore image</button>}
            {selUi.on && (
              <span class="sel-row">
                <span class="muted small">{selUi.inv ? 'Working outside the selection' : 'Working inside the selection'}</span>
                <button class="btn small" onClick={invertSelection}>Invert</button>
                <button class="btn small" onClick={dropSelection}>Deselect</button>
              </span>
            )}
          </>
        )}
      </div>
      <div class="crop-tools">
        <span class="muted small" title="Fills the token behind the picture, so zooming out leaves a colour instead of a gap">Behind picture</span>
        <ColorPick value={props.bg ?? '#20232b'} onChange={(c) => props.onBg(c)} label="Colour behind the picture" onClear={props.bg ? () => props.onBg(null) : undefined} />
      </div>
      <div class="muted small">{imgErr && needsImg ? "This picture's host doesn't let the editor read it, so it can't be selected or cut." : hint}</div>
      <span hidden>{paintTick}</span>
    </div>
  );
}

function hasPixels(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
  return false;
}
