import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Board } from '../board/Board';
import { findLamps, roomLights, type LightSpot } from '../core/autolight';
import type { PixelImage } from '../core/gridcut';
import { LIGHT_PRESETS } from '../core/light';
import { segsOf } from '../core/walls';
import { customLights, subscribeLights } from '../state/lights';
import type { TableClient } from '../state/client';
import type { Rect, Vec } from '../types';
import { Modal, Toggle, toast, useClient, useRerender } from './common';

const WORK_SIDE = 1000;

type Loaded = { img: PixelImage; toScene: (p: Vec) => Vec; fromScene: (p: Vec) => Vec; cellPx: number };

/**
 * "Auto-add lights": the lamps drawn on the map picture and a light for each walled room that has none are worked out and drawn over the map,
 * and one button adds them all as one undoable step. Nothing is added until then.
 */
export function AutoLightsModal(props: { client: TableClient; board: Board | null; onClose: () => void }) {
  const { client, board } = props;
  useClient(client);
  useRerender((fn) => subscribeLights(fn), []);
  const grid = client.grid;
  const meta = client.scene?.meta;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [pictureNote, setPictureNote] = useState('');
  const [ready, setReady] = useState(false);
  const [preset, setPreset] = useState('Torch');
  const [useLamps, setUseLamps] = useState(true);
  const [useRooms, setUseRooms] = useState(true);
  const [rooms, setRooms] = useState<Vec[] | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const walls = client.wallsList();
  const choices = [...LIGHT_PRESETS, ...customLights().map((c) => ({ name: c.name, light: c.light }))];
  const light = (choices.find((c) => c.name === preset) ?? LIGHT_PRESETS[1]).light;
  // how far one light is counted as lighting a room: all of the bright part and half of the dim part
  const reachPx = ((light.b + light.d / 2) / grid.ft) * grid.cell;
  /** lights that are already on the map (a token carrying a light counts) */
  const existing = useMemo(() => [...(client.scene?.tokens.values() ?? [])].filter((t) => t.light && t.light.b + t.light.d > 0).map((t) => ({ x: t.x, y: t.y })), [client.rev]);

  // read the picture once (a scene with no picture still gets room lights)
  useEffect(() => {
    let dead = false;
    void (async () => {
      const r = board ? await board.readMapForWalls(WORK_SIDE) : { error: 'The board is not ready yet.' };
      if (dead) return;
      if ('error' in r) setPictureNote(r.error); else setLoaded(r);
      setReady(true);
    })();
    return () => { dead = true; };
  }, [board]);

  const lamps = useMemo(() => {
    if (!loaded) return [] as Vec[];
    return findLamps(loaded.img, loaded.cellPx).map((l) => loaded.toScene({ x: l.x, y: l.y }));
  }, [loaded]);

  // the rooms, after a pause (a big map takes a moment), counting the lamps as already lit
  const wallSig = walls.map((w) => `${w.a.x},${w.a.y},${w.b.x},${w.b.y}`).join('|');
  useEffect(() => {
    if (!ready) return;
    setRooms(null);
    const t = setTimeout(() => {
      const segs = segsOf(walls, () => true);
      const lit = [...existing, ...(useLamps ? lamps : [])];
      setRooms(useRooms ? roomLights(segs, grid, { reachPx, lit }) : []);
    }, 60);
    return () => clearTimeout(t);
  }, [ready, wallSig, existing, lamps, useLamps, useRooms, reachPx, grid.cell, grid.ox, grid.oy, grid.shape]);

  const spots: LightSpot[] = useMemo(() => [
    ...(useLamps ? lamps.map((p) => ({ ...p, why: 'lamp' as const })) : []),
    ...(rooms ?? []).map((p) => ({ ...p, why: 'room' as const })),
  ], [useLamps, lamps, rooms]);
  const busy = !ready || rooms === null;

  // the area that is drawn: the picture, or (with none) the walls with a margin
  const view: Rect = useMemo(() => {
    if (loaded) {
      const a = loaded.toScene({ x: 0, y: 0 }), b = loaded.toScene({ x: loaded.img.width, y: loaded.img.height });
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const w of walls) for (const p of [w.a, w.b]) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    if (!Number.isFinite(x0)) return { x: 0, y: 0, w: grid.cell * 20, h: grid.cell * 12 };
    const m = grid.cell * 2;
    return { x: x0 - m, y: y0 - m, w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  }, [loaded, wallSig, grid.cell]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (loaded) {
      c.width = loaded.img.width; c.height = loaded.img.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(loaded.img.data), loaded.img.width, loaded.img.height), 0, 0);
    } else {
      c.width = 1000; c.height = Math.max(200, Math.round((1000 * view.h) / view.w));
      const x = c.getContext('2d')!;
      x.fillStyle = '#16181d'; x.fillRect(0, 0, c.width, c.height);
    }
  }, [loaded, view.w, view.h]);

  const noun = (n: number) => `${n} light${n === 1 ? '' : 's'}`;
  const nLamps = spots.filter((s) => s.why === 'lamp').length;
  const nRooms = spots.length - nLamps;
  const add = async () => {
    if (!spots.length) return;
    const items = spots.map((s) => ({ x: s.x, y: s.y, name: preset, size: 0.5, shape: 'none' as const, label: 'dm' as const, hidden: true, light: { ...light } }));
    await client.addTokens(items, 'Auto-add lights');
    toast(`Added ${noun(items.length)}. Ctrl+Z takes them all back.${meta?.light?.ambient === 'bright' ? ' The scene is in daylight, so they only show once it is Twilight or Dark.' : ''}`, 'ok', 6000);
    props.onClose();
  };

  return (
    <Modal title="Auto-add lights" onClose={props.onClose} width={820}
      footer={(
        <>
          <span class="muted grow">{busy ? 'Working…' : spots.length === 0 ? 'Nothing to add.' : `${noun(spots.length)}${nLamps && nRooms ? ` (${nLamps} on the picture, ${nRooms} for rooms)` : ''}.`}</span>
          <button class="btn" onClick={props.onClose}>Cancel</button>
          <button class="btn primary" disabled={busy || spots.length === 0} onClick={() => void add()}>Add {spots.length || ''} light{spots.length === 1 ? '' : 's'}</button>
        </>
      )}>
      <p class="hint">Lights go on the lamps and torches drawn on the picture, and in rooms the walls close off that have none, enough that nearly all of the room is lit.</p>
      <div class="dw-view"><div class="dw-stage">
        <canvas ref={canvas} class="dw-canvas al-canvas" />
        <svg class="dw-over" viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`} preserveAspectRatio="none" aria-hidden="true">
          {walls.map((w, i) => <line key={i} class="al-wall" x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y} />)}
          {spots.map((s, i) => <circle key={`r${i}`} class={`al-reach ${s.why}`} cx={s.x} cy={s.y} r={reachPx} />)}
          {spots.map((s, i) => <circle key={`d${i}`} class={`al-dot ${s.why}`} cx={s.x} cy={s.y} r={Math.max(grid.cell * 0.14, 3)} />)}
        </svg>
      </div></div>
      <div class="dw-controls">
        <div class="row wrap">
          <span class="field-label">Kind of light</span>
          <select value={preset} onChange={(e) => setPreset((e.target as HTMLSelectElement).value)} title="The kind of light to add">
            {choices.map((l) => <option key={l.name} value={l.name}>{l.name} ({l.light.b} + {l.light.d} ft)</option>)}
          </select>
        </div>
        <Toggle checked={useLamps} onChange={setUseLamps} disabled={!loaded}
          label={loaded ? `Lamps and torches on the picture (${lamps.length} found)` : 'Lamps and torches on the picture'}
          hint={loaded ? 'Bright, warm little spots that stand out from the floor round them.' : pictureNote || 'There is no picture to look at.'} />
        <Toggle checked={useRooms} onChange={setUseRooms} label="Rooms the walls close off"
          hint={walls.length ? 'A room is lit when most of it is within reach of a light, with walls in the way.' : 'Draw some walls first: the rooms come from them.'} />
        {existing.length > 0 && <p class="hint">Lights already here ({existing.length}) count: a room they light is left alone.</p>}
        {!busy && spots.length === 0 && (useRooms || useLamps) && walls.length > 0 && <p class="hint">Every room here is already lit, or the walls do not close up into rooms (a gap lets a room leak outside).</p>}
      </div>
    </Modal>
  );
}
