import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Board } from '../board/Board';
import { snapToCorner } from '../core/geometry';
import type { PixelImage } from '../core/gridcut';
import { colorAt, detectPieces, guessWallColor, looksSolid, suggestSensitivity, tidy, type Piece, type Rgb } from '../core/walltrace';
import type { TableClient } from '../state/client';
import type { Vec } from '../types';
import { Modal, SliderField, Toggle, toast, useClient } from './common';

/** The most walls one run adds (more than this means the colour is catching the floor, not the walls). */
const MAX_WALLS = 3000;
/** The picture is looked at this small, whatever its size. */
const WORK_SIDE = 1400;
export const DEFAULT_DETECTED_WALL_FT = 10;

type Loaded = { img: PixelImage; toScene: (p: Vec) => Vec; fromScene: (p: Vec) => Vec; cellPx: number };

/**
 * "Detect walls": the DM clicks a bit of wall on the map picture, and the walls that colour draws are found, shown on the picture, and
 * added in one go (one Ctrl+Z takes them all back). Doors, windows and one-way cliff edges are set by hand afterwards.
 */
export function DetectWallsModal(props: { client: TableClient; board: Board | null; onClose: () => void }) {
  const { client, board } = props;
  useClient(client);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [color, setColor] = useState<Rgb>([30, 30, 30]);
  const [sens, setSens] = useState(22);
  const [mode, setMode] = useState<'lines' | 'edges'>('lines');
  /** false when the picked colour is spread through the picture like texture instead of being one flat colour */
  const [clear, setClear] = useState(true);
  const [skipGrid, setSkipGrid] = useState(true);
  const [minSq, setMinSq] = useState(0.75);
  const [snap, setSnap] = useState(true);
  const [vis, setVis] = useState(true);
  const [height, setHeight] = useState(DEFAULT_DETECTED_WALL_FT);
  const [pieces, setPieces] = useState<Piece[] | null>(null);
  const [busy, setBusy] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef(0);
  const grid = client.grid;
  const existing = client.wallsList().length;

  /** take this colour as the wall colour: work out whether it draws lines or fills areas, and how close a pixel has to be */
  const useColor = (pic: Loaded, col: Rgb) => {
    const sug = suggestSensitivity(pic.img, col);
    const solid = looksSolid(pic.img, col, sug.sens, Math.max(2, pic.cellPx * 0.3));
    setColor(col);
    setClear(sug.clear);
    setMode(solid ? 'edges' : 'lines');
    setSens(solid ? sug.sens : 22);
  };

  // read the picture once
  useEffect(() => {
    let dead = false;
    void (async () => {
      const r = board ? await board.readMapForWalls(WORK_SIDE) : { error: 'The board is not ready yet.' };
      if (dead) return;
      if ('error' in r) { setError(r.error); setBusy(false); return; }
      setLoaded(r);
      useColor(r, guessWallColor(r.img));
    })();
    return () => { dead = true; };
  }, [board]);

  // show it
  useEffect(() => {
    const c = canvas.current;
    if (!c || !loaded) return;
    c.width = loaded.img.width; c.height = loaded.img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(loaded.img.data), loaded.img.width, loaded.img.height), 0, 0);
  }, [loaded]);

  // find the walls again whenever a setting changes (after a short pause, so dragging a slider stays smooth)
  useEffect(() => {
    if (!loaded) return;
    const id = ++run.current;
    setBusy(true);
    const t = setTimeout(() => {
      if (id !== run.current) return;
      // along the edge of solid rock the outline is ragged (crystals, rubble), so it is smoothed and drawn with long straight pieces;
      // a colour that is only texture or shadow has an even rougher outline, so that one is drawn coarser still
      const solid = mode === 'edges';
      const k = clear ? 1 : 2;
      const px = detectPieces(loaded.img, {
        color, sensitivity: sens, thinPx: skipGrid ? 1 : 0, minLen: Math.max(4, loaded.cellPx * minSq),
        tol: solid ? Math.max(2.5, loaded.cellPx * 0.25 * k) : 2.5, smoothPx: solid ? Math.round(loaded.cellPx * 0.2 * k) : 0, mode,
      });
      const scene = px.map((s) => ({ a: loaded.toScene(s.a), b: loaded.toScene(s.b) }));
      const cell = grid.cell;
      const tidied = tidy(scene, { join: Math.max(2, cell * 0.2), snapTol: cell * 0.3, straightDeg: 4, minLen: Math.max(2, cell * minSq), snap: snap ? (p) => snapToCorner(grid, p) : undefined });
      if (id !== run.current) return;
      setPieces(tidied);
      setBusy(false);
    }, 150);
    return () => clearTimeout(t);
  }, [loaded, color, sens, skipGrid, minSq, snap, mode, clear]);

  const shown = useMemo(() => (pieces && loaded ? pieces.map((p) => ({ a: loaded.fromScene(p.a), b: loaded.fromScene(p.b) })) : []), [pieces, loaded]);
  const n = pieces?.length ?? 0;

  const pick = (e: MouseEvent) => {
    const c = canvas.current;
    if (!c || !loaded) return;
    const r = c.getBoundingClientRect();
    useColor(loaded, colorAt(loaded.img, ((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height));
  };
  const guessAgain = () => { if (loaded) useColor(loaded, guessWallColor(loaded.img)); };

  const add = async () => {
    if (!pieces || !pieces.length) return;
    const list = pieces.map((p) => ({ a: p.a, b: p.b, k: 'wall' as const, open: false, vis, one: 0 as const, h: height }));
    await client.addWalls(list, 'Detect walls');
    toast(`Added ${list.length} wall${list.length === 1 ? '' : 's'}. Ctrl+Z takes them all back.`, 'ok', 5000);
    props.onClose();
  };

  return (
    <Modal title="Detect walls" onClose={props.onClose} width={820}
      footer={(
        <>
          <span class="muted grow">{error ? '' : busy ? 'Working…' : n === 0 ? 'No walls found yet.' : n > MAX_WALLS ? `${n} pieces: too many. Click the wall colour again.` : `${n} wall${n === 1 ? '' : 's'} found.`}</span>
          <button class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn primary" disabled={busy || n === 0 || n > MAX_WALLS} onClick={() => void add()}>Add {n || ''} wall{n === 1 ? '' : 's'}</button>
        </>
      )}>
      {error ? <p class="muted">{error}</p> : (
        <>
          <p class="hint">Click a piece of wall on the picture. Everything about that colour becomes a wall. Doors, windows and cliff edges you set yourself afterwards.</p>
          <div class="dw-view"><div class="dw-stage">
            <canvas ref={canvas} class="dw-canvas" onClick={(e) => pick(e as unknown as MouseEvent)} title="Click a bit of wall" />
            {loaded && (
              <svg class="dw-over" viewBox={`0 0 ${loaded.img.width} ${loaded.img.height}`} preserveAspectRatio="none">
                {shown.map((s, i) => <line key={i} x1={s.a.x} y1={s.a.y} x2={s.b.x} y2={s.b.y} />)}
              </svg>
            )}
          </div></div>
          <div class="dw-controls">
            <div class="row">
              <span class="field-label">Wall colour</span>
              <span class="dw-swatch" style={{ background: `rgb(${color[0]},${color[1]},${color[2]})` }} />
              <button class="btn small" onClick={guessAgain}>Guess again</button>
            </div>
            <div class="row">
              <span class="field-label">The colour is</span>
              <div class="seg">
                <button class={mode === 'lines' ? 'on' : ''} title="The colour draws the walls themselves" onClick={() => setMode('lines')}>Thin lines</button>
                <button class={mode === 'edges' ? 'on' : ''} title="The colour fills the rock round the rooms: the walls run along its edge" onClick={() => setMode('edges')}>Solid areas</button>
              </div>
            </div>
            {!clear && <p class="hint warn">This colour is spread all over the picture (texture, shadow, grass), not one flat colour, so what is found here is a guess. Click a flat colour on the wall or rock itself, or draw the walls by hand.</p>}
            <SliderField label="How close the colour must be" value={sens} min={2} max={60} onInput={setSens} hint="Up: catches fainter wall. Down: only the exact colour." />
            <SliderField label="Ignore pieces shorter than" value={minSq} min={0.25} max={3} step={0.25} unit="squares" onInput={setMinSq} />
            <Toggle checked={skipGrid} onChange={setSkipGrid} label="Ignore thin lines (a printed grid)" />
            <Toggle checked={snap} onChange={setSnap} label="Snap ends to grid corners" hint="Where one is close. Leave off on maps with no grid." />
            <Toggle checked={vis} onChange={setVis} label="Players can see them" hint="Off: only you see them. They block either way." />
            <label class="numf" title="How tall they are above the ground. 10 ft suits most dungeon walls. Use 0 for a wall nothing can get over.">
              <span>Height</span>
              <input type="number" min={0} max={1000} step={5} value={height} onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v) && v >= 0) setHeight(Math.round(v)); }} />
              <span class="unit">ft</span>
            </label>
            {existing > 0 && <p class="hint">This scene already has {existing} wall{existing === 1 ? '' : 's'}. The new ones are added on top.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
