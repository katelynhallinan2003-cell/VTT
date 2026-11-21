import { useEffect, useRef, useState } from 'preact/hooks';
import type { TokenShape } from '../types';

const STAGE = 300; // px, the square drag area
const FRAME = 200; // px, the token's diameter inside it

export interface Framing { imgScale: number; imgX: number; imgY: number }
export const NO_FRAMING: Framing = { imgScale: 1, imgX: 0, imgY: 0 };

const px = (n: number) => `${n}px`;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

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
}) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const fr = useRef(props.framing);
  fr.current = props.framing;

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
        style={{ cursor: canDrag ? undefined : 'default' }}
        onPointerDown={(e) => {
          if (!canDrag) return;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: fr.current.imgX, y: fr.current.imgY };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          props.onChange({ ...fr.current, imgX: clamp(d.x + (e.clientX - d.px) / D, -3, 3), imgY: clamp(d.y + (e.clientY - d.py) / D, -3, 3) });
        }}
        onPointerUp={() => { drag.current = null; setDragging(false); }}
        onPointerCancel={() => { drag.current = null; setDragging(false); }}
        onWheel={(e) => {
          if (!canDrag) return;
          e.preventDefault();
          setZoom(fr.current.imgScale * Math.exp(-e.deltaY * 0.0015));
        }}
      >
        {nat && props.src && props.shape !== 'none' && (
          <img class="dim" src={props.src} alt="" style={{ width: px(iw), height: px(ih), left: px(STAGE / 2 + cx - iw / 2), top: px(STAGE / 2 + cy - ih / 2) }} />
        )}
        <div class={`crop-frame ${props.shape}`} style={{ width: px(D), height: px(D), borderRadius: radius, overflow: props.shape === 'none' ? 'visible' : 'hidden' }}>
          {nat && props.src
            ? <img src={props.src} alt="" style={{ width: px(iw), height: px(ih), left: px(D / 2 + cx - iw / 2), top: px(D / 2 + cy - ih / 2) }} />
            : <div class="initial" style={{ background: '#4b5366' }}>{(props.name || '?').trim().charAt(0).toUpperCase() || '?'}</div>}
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
      {props.src && <div class="muted small">Drag the picture to move it. Scroll to zoom.</div>}
    </div>
  );
}
