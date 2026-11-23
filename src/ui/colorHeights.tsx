import { useEffect, useRef, useState } from 'preact/hooks';
import type { Board } from '../board/Board';
import { cellPoly } from '../core/cells';
import { cellCentersIn, cellsCovered, colorRegion } from '../core/colorcells';
import { joinPts } from '../core/draw';
import type { PixelImage } from '../core/gridcut';
import { MAX_STROKE_CELLS, heightColor, newAreaId } from '../core/terrain';
import { colorAt, guessWallColor, type Rgb } from '../core/walltrace';
import type { TableClient } from '../state/client';
import type { Vec } from '../types';
import { Modal, SliderField, Toggle, toast, useClient } from './common';

const WORK_SIDE = 1000;
/** the most cells one run paints (more means the colour is catching the whole floor) */
const MAX_CELLS = 20000;

type Loaded = { img: PixelImage; toScene: (p: Vec) => Vec; fromScene: (p: Vec) => Vec };

/**
 * "Paint height from colour": the DM clicks a colour on the map picture (water, a pit, a raised floor), says how high that ground is,
 * and every grid cell that is mostly that colour is painted as one area of that height. Heights can't be read from a flat picture;
 * this does the tedious part of painting them where the picture already shows the difference.
 */
export function ColorHeightsModal(props: { client: TableClient; board: Board | null; onClose: () => void }) {
  const { client, board } = props;
  useClient(client);
  const grid = client.grid;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [color, setColor] = useState<Rgb | null>(null);
  const [spot, setSpot] = useState<Vec | null>(null);
  const [sens, setSens] = useState(18);
  const [frac, setFrac] = useState(50);
  const [patch, setPatch] = useState(false);
  const [height, setHeight] = useState(-10);
  // the answer for one set of choices; it is stale (and shows "Working…") until it matches the choices on screen
  const [result, setResult] = useState<{ key: string; cells: Vec[] }>({ key: '', cells: [] });
  const key = JSON.stringify([color, spot, sens, frac, patch]);
  const busy = !!color && !!loaded && result.key !== key;
  const cells = busy || !color ? [] : result.cells;
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const run = useRef(0);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const r = board ? await board.readMapForWalls(WORK_SIDE) : { error: 'The board is not ready yet.' };
      if (dead) return;
      if ('error' in r) setError(r.error); else setLoaded(r);
    })();
    return () => { dead = true; };
  }, [board]);

  useEffect(() => {
    const c = base.current;
    if (!c || !loaded) return;
    c.width = loaded.img.width; c.height = loaded.img.height;
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(loaded.img.data), loaded.img.width, loaded.img.height), 0, 0);
    if (over.current) { over.current.width = loaded.img.width; over.current.height = loaded.img.height; }
  }, [loaded]);

  useEffect(() => {
    if (!loaded || !color) return;
    const id = ++run.current;
    const t = setTimeout(() => {
      const { width: w, height: h } = loaded.img;
      const mask = colorRegion(loaded.img, color, sens, patch ? spot : null);
      const a = loaded.toScene({ x: 0, y: 0 }), b = loaded.toScene({ x: w, y: h });
      const centers = cellCentersIn(grid, { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
      const got = cellsCovered(mask, w, h, centers, grid.cell, loaded.fromScene, frac / 100);
      if (id === run.current) setResult({ key, cells: got });
    }, 120);
    return () => clearTimeout(t);
  }, [loaded, color, spot, sens, frac, patch]);

  // the cells it would paint, laid over the picture
  useEffect(() => {
    const c = over.current;
    if (!c || !loaded) return;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = heightColor(height);
    x.globalAlpha = 0.6;
    x.strokeStyle = '#ffffff';
    for (const ce of cells) {
      const poly = cellPoly(grid, ce).map(loaded.fromScene);
      x.beginPath();
      poly.forEach((p, i) => (i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y)));
      x.closePath();
      x.fill();
    }
  }, [cells, height, loaded]);

  const pick = (e: MouseEvent) => {
    const c = base.current;
    if (!c || !loaded) return;
    const r = c.getBoundingClientRect();
    const px = { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
    setColor(colorAt(loaded.img, px.x, px.y, 2));
    setSpot(px);
  };

  const add = async () => {
    if (!cells.length) return;
    const hex = grid.shape !== 'square';
    const hg = newAreaId();
    const list = [];
    for (let i = 0; i < cells.length; i += MAX_STROKE_CELLS) {
      list.push({ k: 'terrain' as const, p: joinPts(cells.slice(i, i + MAX_STROKE_CELLS)), color: heightColor(height), w: grid.cell * (hex ? 1.16 : 1), fill: 0, fc: '', dash: false, txt: '', fs: 28, bw: 5, hz: height, hg, ha: false, he: false, hc: true });
    }
    await client.addDrawings(list, 'Paint height from colour');
    toast(`Painted ${cells.length} ${hex ? 'hex' : 'square'}${cells.length === 1 ? '' : 's'} at ${height} ft. Ctrl+Z takes it back.`, 'ok', 5000);
    props.onClose();
  };

  const tooMany = cells.length > MAX_CELLS;
  const word = grid.shape === 'square' ? 'square' : 'hex';
  return (
    <Modal title="Paint height from colour" onClose={props.onClose} width={820}
      footer={(
        <>
          <span class="muted grow">{error ? '' : !color ? 'Click the colour on the picture.' : busy ? 'Working…' : tooMany ? `${cells.length} cells: too many. Try a closer colour.` : `${cells.length} ${word}${cells.length === 1 ? '' : 's'} would be painted.`}</span>
          <button class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn primary" disabled={busy || !cells.length || tooMany} onClick={() => void add()}>Paint {cells.length || ''} {word}{cells.length === 1 ? '' : 's'}</button>
        </>
      )}>
      {error ? <p class="muted">{error}</p> : (
        <>
          <p class="hint">Click the colour of the ground you want to raise or lower (water, a pit, a platform). Everything that colour is painted as one area. Run it again for another colour.</p>
          <div class="dw-view"><div class="dw-stage">
            <canvas ref={base} class="dw-canvas" onClick={(e) => pick(e as unknown as MouseEvent)} title="Click the ground colour" />
            <canvas ref={over} class="dw-over" />
          </div></div>
          <div class="dw-controls">
            <div class="row">
              <span class="field-label">Colour</span>
              {color ? <span class="dw-swatch" style={{ background: `rgb(${color[0]},${color[1]},${color[2]})` }} /> : <span class="muted">none picked yet</span>}
              {loaded && color && <button class="btn small" onClick={() => { setColor(guessWallColor(loaded.img)); setSpot(null); }} title="Pick the darkest main colour">Darkest colour</button>}
            </div>
            <label class="numf" title="Feet above the map's base level. Negative is lower: −10 for water or a pit.">
              <span>Height</span>
              <input type="number" min={-1000} max={5000} step={5} value={height} onChange={(e) => { const v = Number((e.target as HTMLInputElement).value); if (Number.isFinite(v)) setHeight(Math.round(v)); }} />
              <span class="unit">ft</span>
            </label>
            <SliderField label="How close the colour must be" value={sens} min={2} max={60} onInput={setSens} hint="Up: catches more shades. Down: only the exact colour." />
            <SliderField label={`${word === 'square' ? 'Square' : 'Hex'} counts when this much is that colour`} value={frac} min={20} max={95} step={5} unit="%" onInput={setFrac} />
            <Toggle checked={patch} onChange={setPatch} label="Only the patch I clicked" hint="Leave off to paint every place on the map with this colour." />
          </div>
        </>
      )}
    </Modal>
  );
}
