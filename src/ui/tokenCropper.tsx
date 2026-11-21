import { useEffect, useRef, useState } from 'preact/hooks';
import { canvasToBlob, loadImage } from '../core/images';
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
  hasPaint(): boolean;
  /** Merge the framed picture and the paint into one square PNG. */
  bake(src: string | null, framing: Framing, shape: TokenShape): Promise<Blob>;
}

const PAINT_SIZE = 512;

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
  const [mode, setMode] = useState<'move' | 'paint' | 'erase'>('move');
  const [brush, setBrush] = useState('#ffffff');
  const [brushSize, setBrushSize] = useState(36);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const painting = useRef(false);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const snaps = useRef<ImageData[]>([]);
  const dirtyPaint = useRef(false);
  const [paintTick, setPaintTick] = useState(0);

  const paintPoint = (e: PointerEvent) => {
    const r = frameRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PAINT_SIZE, y: ((e.clientY - r.top) / r.height) * PAINT_SIZE };
  };
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = paintRef.current!.getContext('2d', { willReadFrequently: true })!;
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = brush; ctx.fillStyle = brush; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = brushSize;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (a.x === b.x && a.y === b.y) { ctx.beginPath(); ctx.arc(a.x, a.y, brushSize / 2, 0, Math.PI * 2); ctx.fill(); }
  };
  const clearPaint = () => {
    const c = paintRef.current;
    if (!c) return;
    snaps.current.push(c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE));
    c.getContext('2d', { willReadFrequently: true })!.clearRect(0, 0, PAINT_SIZE, PAINT_SIZE);
    dirtyPaint.current = false;
    setPaintTick((n) => n + 1);
  };
  const undoStroke = () => {
    const c = paintRef.current;
    const snap = snaps.current.pop();
    if (!c || !snap) return;
    c.getContext('2d', { willReadFrequently: true })!.putImageData(snap, 0, 0);
    dirtyPaint.current = hasPixels(c);
    setPaintTick((n) => n + 1);
  };

  useEffect(() => {
    if (!props.paintApi) return;
    props.paintApi.current = {
      hasPaint: () => dirtyPaint.current,
      bake: async (src, framing, shape) => {
        const c = document.createElement('canvas');
        c.width = c.height = PAINT_SIZE;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        if (src) {
          const img = await loadImage(src, true);
          const fitK = shape === 'none' ? Math.min(PAINT_SIZE / img.naturalWidth, PAINT_SIZE / img.naturalHeight) : Math.max(PAINT_SIZE / img.naturalWidth, PAINT_SIZE / img.naturalHeight);
          const w = img.naturalWidth * fitK * framing.imgScale;
          const h = img.naturalHeight * fitK * framing.imgScale;
          ctx.drawImage(img, PAINT_SIZE / 2 + framing.imgX * PAINT_SIZE - w / 2, PAINT_SIZE / 2 + framing.imgY * PAINT_SIZE - h / 2, w, h);
        }
        ctx.drawImage(paintRef.current!, 0, 0);
        return canvasToBlob(c, 'image/png');
      },
    };
    return () => { if (props.paintApi) props.paintApi.current = null; };
  }, [props.paintApi]);

  useEffect(() => {
    setNat(null);
    if (!props.src) return;
    let dead = false;
    const im = new Image();
    im.onload = () => { if (!dead) setNat({ w: im.naturalWidth, h: im.naturalHeight }); };
    im.src = props.src;
    return () => { dead = true; };
  }, [props.src]);

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

  const setZoom = (z: number) => props.onChange({ ...fr.current, imgScale: clamp(z, 0.2, 8) });

  return (
    <div class="cropper">
      <div
        class={`crop-stage ${dragging ? 'drag' : ''}`}
        style={{ cursor: mode !== 'move' ? 'crosshair' : canDrag ? undefined : 'default' }}
        onPointerDown={(e) => {
          if (props.disabled) return;
          if (mode !== 'move') {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const c = paintRef.current!;
            snaps.current.push(c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, PAINT_SIZE, PAINT_SIZE));
            if (snaps.current.length > 25) snaps.current.shift();
            painting.current = true;
            const pt = paintPoint(e);
            lastPt.current = pt;
            stroke(pt, pt);
            if (mode === 'paint') { dirtyPaint.current = true; props.onPaint?.(); }
            return;
          }
          if (!canDrag) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: fr.current.imgX, y: fr.current.imgY };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          if (painting.current && lastPt.current) {
            const pt = paintPoint(e);
            stroke(lastPt.current, pt);
            lastPt.current = pt;
            return;
          }
          const d = drag.current;
          if (!d) return;
          props.onChange({ ...fr.current, imgX: clamp(d.x + (e.clientX - d.px) / D, -3, 3), imgY: clamp(d.y + (e.clientY - d.py) / D, -3, 3) });
        }}
        onPointerUp={() => { drag.current = null; painting.current = false; lastPt.current = null; setDragging(false); setPaintTick((n) => n + 1); }}
        onPointerCancel={() => { drag.current = null; painting.current = false; lastPt.current = null; setDragging(false); }}
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
            ? <img src={props.src} alt="" style={{ width: px(iw), height: px(ih), left: px(D / 2 + cx - iw / 2), top: px(D / 2 + cy - ih / 2) }} />
            : <div class="initial" style={{ background: props.bg ?? '#4b5366' }}>{(props.name || '?').trim().charAt(0).toUpperCase() || '?'}</div>}
          <canvas ref={paintRef} class="paint-layer" width={PAINT_SIZE} height={PAINT_SIZE} />
        </div>
        {ringPx > 0 && <div class="crop-ring" style={{ width: px(D), height: px(D), borderRadius: radius, borderWidth: px(ringPx), borderColor: props.ring }} />}
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
        <div class="seg">
          <button class={mode === 'move' ? 'on' : ''} onClick={() => setMode('move')} title="Drag the picture around">Move</button>
          <button class={mode === 'paint' ? 'on' : ''} onClick={() => setMode('paint')} title="Paint over the token">Paint</button>
          <button class={mode === 'erase' ? 'on' : ''} onClick={() => setMode('erase')} title="Rub out your painting">Erase</button>
        </div>
      </div>
      <div class="crop-tools brush-row">
        {mode !== 'move' && (
          <>
            {mode === 'paint' && <ColorPick value={brush} onChange={setBrush} label="Brush colour" />}
            <input type="range" min={4} max={140} value={brushSize} onInput={(e) => setBrushSize(Number((e.target as HTMLInputElement).value))} title="Brush size" />
            <button class="btn small" disabled={snaps.current.length === 0} onClick={undoStroke}>Undo stroke</button>
            <button class="btn small" onClick={clearPaint}>Clear paint</button>
          </>
        )}
      </div>
      <div class="crop-tools">
        <span class="muted small" title="Fills the token behind the picture, so zooming out leaves a colour instead of a gap">Behind picture</span>
        <ColorPick value={props.bg ?? '#20232b'} onChange={(c) => props.onBg(c)} label="Colour behind the picture" onClear={props.bg ? () => props.onBg(null) : undefined} />
      </div>
      <div class="muted small">{mode === 'move' ? 'Drag the picture to move it. Scroll to zoom.' : 'Paint sits on top of the picture and is saved into it.'}</div>
      <span hidden>{paintTick}</span>
    </div>
  );
}

function hasPixels(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return true;
  return false;
}
