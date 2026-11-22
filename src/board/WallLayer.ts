import { Container, Graphics } from 'pixi.js';
import { hatchTicks, wallLength, wallMid, type Wall, type WallKind } from '../core/walls';
import type { Vec } from '../types';

const COLOR: Record<WallKind, number> = { wall: 0xffd27a, door: 0xe8873a, window: 0x7fd8ff };
const SELECT = 0x4da3ff;
const HOVER = 0xffffff;

export interface WallDrawOpts {
  /** zoom of the camera (line widths are kept the same on screen) */
  z: number;
  /** grid cell size in pixels */
  cell: number;
  /** show the walls the players do not see too (the DM's view) */
  showAll: boolean;
  /** the walls to outline, with a handle on each end */
  selected: Set<string>;
  /** the wall under the pointer in the Walls tool */
  hover: string | null;
  /** show the end handles even for walls that are not selected (the Walls tool's edit mode) */
  handles: boolean;
}

/** A dashed line a→b. Pixi has no dashes of its own. */
function dashed(g: Graphics, a: Vec, b: Vec, dash: number, gap: number) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 0.5) return;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * e, a.y + uy * e);
  }
}

/**
 * Draws the walls, doors and windows. Plain walls are what the DM sees on the map; players only get the ones marked as visible.
 * Everything is redrawn only when the walls, the zoom or the selection change.
 */
export class WallLayer {
  readonly container = new Container();
  private g = new Graphics();
  private key = '';

  constructor() { this.container.addChild(this.g); }

  clear() { this.g.clear(); this.key = ''; }

  sync(walls: Wall[], o: WallDrawOpts, rev: number | string, show: boolean) {
    this.container.visible = show;
    if (!show) return;
    const key = `${rev}|${o.z.toFixed(3)}|${o.cell}|${o.showAll ? 1 : 0}|${o.handles ? 1 : 0}|${[...o.selected].sort().join(',')}|${o.hover ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    this.build(walls, o);
  }

  private build(walls: Wall[], o: WallDrawOpts) {
    const g = this.g;
    g.clear();
    const px = 1 / o.z;
    const w = Math.max(2.5 * px, o.cell * 0.05);
    const list = o.showAll ? walls : walls.filter((x) => x.vis);
    // under-strokes first so crossing walls do not cut each other
    for (const s of list) {
      g.moveTo(s.a.x, s.a.y).lineTo(s.b.x, s.b.y);
    }
    g.stroke({ width: w + 3 * px, color: 0x000000, alpha: 0.55, cap: 'round', join: 'round' });

    for (const s of list) {
      const col = COLOR[s.k];
      const hidden = !s.vis; // only the DM gets to see these
      const a = s.a, b = s.b;
      if (s.k === 'door' && s.open) {
        dashed(g, a, b, 6 * px, 5 * px);
        g.stroke({ width: w * 0.7, color: col, alpha: 0.55, cap: 'butt' });
      } else if (hidden) {
        dashed(g, a, b, 9 * px, 6 * px);
        g.stroke({ width: w, color: col, alpha: 0.85, cap: 'butt' });
      } else if (s.k === 'window') {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 1.5, color: col, alpha: 0.9, cap: 'round' });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: w * 0.5, color: 0xffffff, alpha: 0.9, cap: 'round' });
      } else {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: s.k === 'door' ? w * 1.4 : w, color: col, cap: 'round' });
      }
    }

    // one-way walls (a cliff edge): little ticks on the side that is stopped
    for (const s of list) {
      if (!s.one) continue;
      for (const t of hatchTicks(s.a, s.b, s.one, o.cell * 0.32, o.cell * 0.17)) g.moveTo(t.a.x, t.a.y).lineTo(t.b.x, t.b.y);
      g.stroke({ width: Math.max(1.6 * px, o.cell * 0.026), color: COLOR[s.k], alpha: s.vis ? 0.95 : 0.8, cap: 'round' });
    }

    // door handles: a diamond in the middle (hollow when the door stands open)
    for (const s of list) {
      if (s.k !== 'door') continue;
      const m = wallMid(s);
      const r = Math.min(wallLength(s) * 0.3, Math.max(5 * px, o.cell * 0.14));
      g.poly([m.x, m.y - r, m.x + r, m.y, m.x, m.y + r, m.x - r, m.y]);
      if (s.open) g.stroke({ width: 2 * px, color: COLOR.door });
      else { g.fill({ color: 0xffffff }); g.stroke({ width: 1.5 * px, color: 0x000000, alpha: 0.7 }); }
    }

    // selection and hover
    for (const s of list) {
      const sel = o.selected.has(s.id);
      const hov = o.hover === s.id;
      if (!sel && !hov) continue;
      g.moveTo(s.a.x, s.a.y).lineTo(s.b.x, s.b.y);
      g.stroke({ width: w + 5 * px, color: sel ? SELECT : HOVER, alpha: sel ? 0.55 : 0.3, cap: 'round' });
    }
    if (o.handles) {
      for (const s of list) {
        const sel = o.selected.has(s.id);
        for (const p of [s.a, s.b]) {
          g.circle(p.x, p.y, (sel ? 5 : 3.5) * px);
          g.fill({ color: sel ? 0xffffff : 0x1b1f27, alpha: sel ? 1 : 0.85 });
          g.stroke({ width: 1.5 * px, color: sel ? SELECT : 0xffffff, alpha: 0.95 });
        }
      }
    }
  }
}
