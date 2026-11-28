import { spellSurface, type SurfaceImage } from './spellSurface';
import { snapToCellCenter } from './geometry';
import type { GridSettings, Vec } from '../types';
import { isHex } from './hex';
import { mapSegments, spellVolume, type Spell, type SpellWorld } from './spellVolume';
export type Volume = ReturnType<typeof spellVolume>;
export interface SpellPicture {
  surface: SurfaceImage;
  /** Rectangles as left, top, right, bottom or hex centers as x, y. */
  fill: Float32Array;
  hex: boolean;
  solid: boolean;
  outline: Float32Array;
  wire: Float32Array;
  contact: Float32Array;
}
export function spellOutline(v: Volume): Vec[] {
  const g = v.geom;
  if (g.type === 'poly') return g.pts;
  return Array.from({
    length: 96
  }, (_, i) => ({
    x: g.c.x + g.r * Math.cos(i * Math.PI / 48),
    y: g.c.y + g.r * Math.sin(i * Math.PI / 48)
  }));
}
const lerp = (a: Vec, b: Vec, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});
const add = (out: number[], a: Vec, b: Vec) => {
  out.push(a.x, a.y, b.x, b.y);
};

/** Sample a projected volume at the actual surface. Outline, interior wires and the
 * surface cut are distinct: the top of a solid can clear ground while a lower wire is buried. */
export function floorLines(v: Volume, grid: GridSettings, world: SpellWorld, elevated: boolean, fast = false, withContact = true) {
  const ground = world.ground ?? (() => 0),
    maps = world.maps ?? [];
  const outline: number[] = [],
    wire: number[] = [],
    contact: number[] = [];
  const tol = 1e-5,
    step = Math.max(grid.cell / (fast ? 3 : 8), Math.max(v.bounds.w, v.bounds.h) / (fast ? 44 : 96), .01);
  function line(out: number[], a: Vec, b: Vec, height: (p: Vec, t: number) => number) {
    for (const [l, r] of mapSegments(a, b, maps)) {
      if (!elevated) {
        add(out, l, r);
        continue;
      }
      const dx = b.x - a.x,
        dy = b.y - a.y,
        den = dx * dx + dy * dy;
      if (!den) continue;
      const above = (p: Vec) => height(p, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den) >= ground(p) - tol;
      const n = Math.max(1, Math.ceil(Math.hypot(r.x - l.x, r.y - l.y) / step));
      let prev = l,
        show = above(l),
        begin = l;
      for (let i = 1; i <= n; i++) {
        const q = lerp(l, r, i / n),
          visible = above(q);
        if (visible !== show) {
          let low = prev,
            high = q;
          for (let k = 0; k < 9; k++) {
            const mid = lerp(low, high, .5);
            if (above(mid) === show) low = mid;else high = mid;
          }
          const cut = lerp(low, high, .5);
          if (show) add(out, begin, cut);else begin = cut;
        }
        prev = q;
        show = visible;
      }
      if (show) add(out, begin, r);
    }
  }
  const ring = spellOutline(v);
  for (let i = 0; i < ring.length; i++) line(outline, ring[i], ring[(i + 1) % ring.length], p => v.heightSpan(p)?.[1] ?? v.axis.start);
  for (const path of v.edges) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    line(wire, a, b, (_, t) => a.height + (b.height - a.height) * t);
  }

  // Pad the sampling domain so floor contacts which meet the silhouette also close.
  // Sample shared edges identically on both sides, including discontinuous ledges.
  if (withContact && elevated && v.bounds.w > 0 && v.bounds.h > 0) {
    const {
        x,
        y,
        w,
        h
      } = v.bounds,
      cols = Math.max(2, Math.ceil(w / step)) + 2,
      rows = Math.max(2, Math.ceil(h / step)) + 2;
    const pos = (i: number, j: number) => ({
      x: x + w * (i - 1) / (cols - 2),
      y: y + h * (j - 1) / (rows - 2)
    });
    function state(p: Vec) {
      const span = v.heightSpan(p);
      if (!span) return -Infinity;
      const z = ground(p);
      return Math.min(z - span[0], span[1] - z) + tol;
    }
    const row = (j: number) => Float64Array.from({
      length: cols + 1
    }, (_, i) => state(pos(i, j)));
    let upper = row(0);
    for (let j = 0; j < rows; j++) {
      const lower = row(j + 1);
      for (let i = 0; i < cols; i++) {
        const values = [upper[i], upper[i + 1], lower[i + 1], lower[i]];
        if (!values.some(n => n >= 0) || !values.some(n => n < 0)) continue;
        const points = [pos(i, j), pos(i + 1, j), pos(i + 1, j + 1), pos(i, j + 1)],
          cross: {
            p: Vec;
            inside: boolean;
          }[] = [];
        for (let k = 0; k < 4; k++) {
          const n = (k + 1) % 4;
          if (values[k] >= 0 === values[n] >= 0) continue;
          let a = points[k],
            b = points[n];
          for (let t = 0; t < 7; t++) {
            const q = lerp(a, b, .5);
            if (state(q) >= 0 === values[k] >= 0) a = q;else b = q;
          }
          cross.push({
            p: lerp(a, b, .5),
            inside: Number.isFinite(state(values[k] < 0 ? a : b))
          });
        }
        if (cross.length === 4 && state(lerp(points[0], points[2], .5)) >= 0 !== values[0] >= 0) cross.push(cross.shift()!);
        for (let k = 1; k < cross.length; k += 2) {
          const l = cross[k - 1],
            r = cross[k];
          if (!l.inside && !r.inside) continue;
          for (const [a, b] of mapSegments(l.p, r.p, maps)) add(contact, a, b);
        }
      }
      upper = lower;
    }
  }
  return {
    outline: new Float32Array(outline),
    wire: new Float32Array(wire),
    contact: new Float32Array(contact)
  };
}
export interface PictureRequest {
  color: string;
  spell: Spell;
  a: Vec;
  b: Vec;
  cover: boolean;
  fast: boolean;
}
export function spellPicture(req: PictureRequest, grid: GridSettings, world: SpellWorld): SpellPicture {
  const {
      spell,
      a,
      b,
      cover,
      fast
    } = req,
    v = spellVolume(spell, a, b, grid, world);
  const lines = floorLines(v, grid, world, spell.spell?.elevation !== false, fast);
  const solid = !cover && !v.hasWalls && !v.groundClips;
  const diameter = Math.max(v.bounds.w, v.bounds.h);
  const unit = grid.cell / 4;
  const previewCell = unit * 2 ** Math.max(0, Math.ceil(Math.log2(diameter / (40 * unit))));
  const sampling = cover ? grid : {
    ...grid,
    shape: 'square' as const,
    cell: fast ? previewCell : Math.max(grid.cell / 10, diameter / 140)
  };
  const hex = isHex(sampling),
    data: number[] = [];
  let reached: ((x: number, y: number) => boolean) | undefined;
  if (!solid) {
    const cells = v.cells(sampling);
    if (v.hasWalls || v.groundClips) {
      // On gridded maps the core of each covered cell is authoritative. The
      // spell shell still has a smooth outer rim where the center misses it.
      const occupied = new Map<number, Set<number>>();
      const tile = (x: number) => Math.round(x / sampling.cell * 1024);
      for (const p of cells) {
        const y = tile(p.y);
        let row = occupied.get(y);
        if (!row) occupied.set(y, row = new Set());
        row.add(tile(p.x));
      }
      // Vertical faces project onto a footprint edge. A sample just outside it
      // carries no information about blockers. Test the face itself there.
      const boundary = new Map<number, Map<number, boolean>>();
      reached = (x, y) => {
        const c = snapToCellCenter(sampling, {
          x,
          y
        });
        if (occupied.get(tile(c.y))?.has(tile(c.x))) return true;
        if (v.heightSpan(c)) return false;
        const ix = Math.round(x * 8 / sampling.cell);
        const iy = Math.round(y * 8 / sampling.cell);
        let row = boundary.get(iy);
        if (!row) boundary.set(iy, row = new Map());
        let visible = row.get(ix);
        if (visible === undefined) {
          visible = v.hits({ x, y });
          row.set(ix, visible);
        }
        return visible;
      };
    }
    if (hex) for (const p of cells) data.push(p.x, p.y);else {
      cells.sort((a, b) => a.y - b.y || a.x - b.x);
      const h = sampling.cell / 2;
      for (let i = 0; i < cells.length;) {
        const p = cells[i++];
        let right = p.x + h;
        while (i < cells.length && cells[i].y === p.y && cells[i].x - h <= right + 1e-6) right = cells[i++].x + h;
        data.push(p.x - h, p.y - h, right, p.y + h);
      }
    }
  }
  const surface = spellSurface(spell, a, v, grid, world, req.color, fast, reached);
  return {
    ...lines,
    surface,
    solid,
    hex,
    fill: new Float32Array(data)
  };
}
