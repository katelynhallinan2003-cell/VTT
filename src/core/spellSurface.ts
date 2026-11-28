import { expandPoly, footprintPoly, pointInPoly, templateWidthPx } from './draw';
import { onMap, type Spell, type SpellWorld } from './spellVolume';
import type { Volume } from './spellPicture';
import type { GridSettings, Vec } from '../types';
interface V3 extends Vec {
  z: number;
}
interface Vertex extends V3 {
  n: V3;
}
export interface SurfaceImage {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  rgba: Uint8ClampedArray;
}
const vec = (x: number, y: number, z: number): V3 => ({
  x,
  y,
  z
});
const unit = (v: V3) => {
  const d = Math.hypot(v.x, v.y, v.z) || 1;
  return vec(v.x / d, v.y / d, v.z / d);
};
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const vertex = (p: V3, n: V3): Vertex => ({
  ...p,
  n
});

/** Shallow oblique rendering of the same oriented solid used for spell hits.
 * The casting point anchors the model; the separate board fill stays in map coordinates. */
export function spellSurface(spell: Spell, a: Vec, v: Volume, grid: GridSettings, world: SpellWorld, tint: string, fast: boolean, reached?: (x: number, y: number) => boolean): SurfaceImage {
  const sx = .25,
    sy = -.43,
    view = unit(vec(-sx, -sy, 1)),
    light = unit(vec(-.55, -.6, .78));
  const halfway = unit(vec(light.x + view.x, light.y + view.y, light.z + view.z));
  const {
      start,
      end,
      ux,
      uy,
      run
    } = v.axis,
    scale = grid.cell / grid.ft;
  const rise = (end - start) * scale,
    len = Math.hypot(run, rise),
    co = len ? run / len : 1,
    si = len ? rise / len : 0;
  const basis = (along: number, side: number, up: number) => vec(ux * (co * along - si * up) - uy * side, uy * (co * along - si * up) + ux * side, si * along + co * up);
  const faces: [Vertex, Vertex, Vertex, number][] = [];
  const tri = (a: Vertex, b: Vertex, c: Vertex, id = 1) => faces.push([a, b, c, id]);
  const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex, id: number) => {
    tri(a, b, c, id);
    tri(a, c, d, id);
  };
  const half = templateWidthPx(grid, spell) / 2,
    n = fast ? 24 : 48;
  let inner: Vec[] | undefined;
  if (spell.k === 'sphere' || spell.k === 'emanation') {
    const radius = spell.k === 'sphere' ? run : Math.max(0, run - half);
    let directions: {
      x: number;
      y: number;
      dx: number;
      dy: number;
    }[];
    if (spell.k === 'emanation') {
      inner = footprintPoly(a, half * 2, grid.shape === 'square' ? undefined : grid.shape);
      const foot = inner.map(p => ({
          x: p.x - a.x,
          y: p.y - a.y
        })),
        one = expandPoly(foot, 1),
        two = expandPoly(foot, 2);
      directions = one.map((p, i) => ({
        x: 2 * p.x - two[i].x,
        y: 2 * p.y - two[i].y,
        dx: two[i].x - p.x,
        dy: two[i].y - p.y
      }));
      // Inner faces make the open space around the caster visible in the tilted view.
      for (let i = 0; i < foot.length; i++) {
        const p = foot[i],
          q = foot[(i + 1) % foot.length],
          normal = unit(vec(p.y - q.y, q.x - p.x, 0));
        const at = (p: Vec, h: number) => vertex(vec(p.x, p.y, h), normal);
        quad(at(p, -radius), at(p, radius), at(q, radius), at(q, -radius), i + 3);
      }
    } else directions = Array.from({
      length: n
    }, (_, i) => ({
      x: 0,
      y: 0,
      dx: Math.cos(2 * Math.PI * i / n),
      dy: Math.sin(2 * Math.PI * i / n)
    }));
    let prev: Vertex[] = [];
    const bands = fast ? 10 : 20;
    for (let j = 0; j <= bands; j++) {
      const phi = Math.PI * (j / bands - .5),
        cs = Math.cos(phi),
        sn = Math.sin(phi);
      const ring = directions.map(d => vertex(vec(d.x + d.dx * radius * cs, d.y + d.dy * radius * cs, radius * sn), vec(d.dx * cs, d.dy * cs, sn)));
      if (j) for (let i = 0; i < ring.length; i++) {
        const k = (i + 1) % ring.length;
        quad(prev[i], prev[k], ring[k], ring[i], 1);
      }
      prev = ring;
    }
  } else if (spell.k === 'cone') {
    const center = basis(len, 0, 0),
      tip = vec(0, 0, 0),
      front = basis(1, 0, 0);
    const rim = (i: number) => {
      const t = 2 * Math.PI * i / n,
        c = Math.cos(t),
        s = Math.sin(t);
      return vertex(basis(len, len * c / 2, len * s / 2), unit(basis(-.5, c, s)));
    };
    for (let i = 0; i < n; i++) {
      const p = rim(i),
        q = rim(i + 1);
      tri(vertex(tip, unit(vec(p.n.x + q.n.x, p.n.y + q.n.y, p.n.z + q.n.z))), p, q);
      tri(vertex(center, front), vertex(p, front), vertex(q, front), 2);
    }
  } else {
    const h = spell.k === 'cube' ? len / 2 : half;
    for (const side of [-1, 1]) {
      const cap = (x: number, y: number, z: number) => basis(x, y * h, z * h);
      const face = (ps: V3[], normal: V3, id: number) => quad(vertex(ps[0], normal), vertex(ps[1], normal), vertex(ps[2], normal), vertex(ps[3], normal), id);
      const t = side < 0 ? 0 : len;
      face([cap(t, -1, -1), cap(t, 1, -1), cap(t, 1, 1), cap(t, -1, 1)], basis(side, 0, 0), side + 2);
      face([cap(0, side, -1), cap(len, side, -1), cap(len, side, 1), cap(0, side, 1)], basis(0, side, 0), side + 5);
      face([cap(0, -1, side), cap(len, -1, side), cap(len, 1, side), cap(0, 1, side)], basis(0, 0, side), side + 8);
    }
  }
  const projX = (p: V3) => p.x + sx * p.z,
    projY = (p: V3) => p.y + sy * p.z;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [p, q, r] of faces) for (const t of [p, q, r]) {
    const x = projX(t),
      y = projY(t);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  const pixel = Math.max(.25, (x1 - x0) / (fast ? 86 : 240), (y1 - y0) / (fast ? 86 : 240));
  const cols = Math.max(1, Math.ceil((x1 - x0) / pixel) + 2),
    rows = Math.max(1, Math.ceil((y1 - y0) / pixel) + 2);
  x0 -= pixel;
  y0 -= pixel;
  const rgba = new Uint8ClampedArray(cols * rows * 4),
    depth = new Float32Array(cols * rows).fill(-Infinity),
    groups = new Uint8Array(cols * rows);
  const rgb = Number.parseInt(tint.slice(1), 16),
    channels = [rgb >> 16, rgb >> 8 & 255, rgb & 255];
  const elevated = spell.spell?.elevation !== false,
    maps = world.maps;
  // During a drag, shade against a fixed fine terrain lattice. The exact cast
  // and its ground-contact lines still use the original ground function.
  const sampleStep = grid.cell / 24;
  const floorAt = fast && world.ground ? (p: Vec) => world.ground!({
    x: Math.round(p.x / sampleStep) * sampleStep,
    y: Math.round(p.y / sampleStep) * sampleStep
  }) : world.ground;
  for (const [p, q, r, id] of faces) {
    // With the viewer above the floor the nearest outside face owns each pixel.
    if (dot(p.n, view) < 0 && dot(q.n, view) < 0 && dot(r.n, view) < 0) continue;
    const ax = (projX(p) - x0) / pixel,
      ay = (projY(p) - y0) / pixel,
      bx = (projX(q) - x0) / pixel,
      by = (projY(q) - y0) / pixel,
      cx = (projX(r) - x0) / pixel,
      cy = (projY(r) - y0) / pixel;
    const det = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(det) < 1e-8) continue;
    const left = Math.max(0, Math.floor(Math.min(ax, bx, cx))),
      right = Math.min(cols - 1, Math.ceil(Math.max(ax, bx, cx)));
    const top = Math.max(0, Math.floor(Math.min(ay, by, cy))),
      bottom = Math.min(rows - 1, Math.ceil(Math.max(ay, by, cy)));
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
      const dx = x + .5 - ax,
        dy = y + .5 - ay,
        b = (dx * (cy - ay) - dy * (cx - ax)) / det,
        c = ((bx - ax) * dy - (by - ay) * dx) / det,
        f = 1 - b - c;
      if (Math.min(f, b, c) < -1e-7) continue;
      const z = f * p.z + b * q.z + c * r.z,
        i = y * cols + x;
      if (z < depth[i]) continue;
      const at = {
        x: a.x + f * p.x + b * q.x + c * r.x,
        y: a.y + f * p.y + b * q.y + c * r.y
      };
      if (spell.k === 'beam' && (at.x - a.x) * ux + (at.y - a.y) * uy < -.001) continue;
      if (inner && id === 1 && pointInPoly(at, inner)) continue;
      if (maps?.length && (!onMap(at, maps) || !onMap({
        x: a.x + x0 + (x + .5) * pixel,
        y: a.y + y0 + (y + .5) * pixel
      }, maps))) continue;
      if (elevated && start + z / scale < (floorAt?.(at) ?? 0) - .0001) continue;
      if (reached && !reached(at.x, at.y)) continue;
      const normal = unit(vec(f * p.n.x + b * q.n.x + c * r.n.x, f * p.n.y + b * q.n.y + c * r.n.y, f * p.n.z + b * q.n.z + c * r.n.z));
      const diffuse = Math.max(0, dot(normal, light)),
        rim = (1 - Math.max(0, dot(normal, view))) ** 3;
      const shine = .10 * diffuse + .44 * Math.max(0, dot(normal, halfway)) ** 20 + .26 * rim;
      const tone = .22 + .78 * diffuse;
      for (let k = 0; k < 3; k++) rgba[4 * i + k] = channels[k] * tone * (1 - shine) + 255 * shine;
      // A few curved surface lines describe the round shell even over busy artwork.
      // They use the interpolated surface normal, so they turn with the object and
      // end at a ledge or a buried part of the shell just like the shaded faces.
      let arc = 0;
      if ((spell.k === 'sphere' || spell.k === 'emanation') && id === 1) {
        const width = Math.max(.009, pixel / Math.max(1, run) * 1.15);
        const seam = Math.min(Math.abs(normal.z - .5), Math.abs(normal.x * .77 + normal.y * .64));
        arc = Math.max(0, 1 - seam / width) * .78;
      }
      if (arc) for (let k = 0; k < 3; k++) rgba[4 * i + k] = rgba[4 * i + k] * (1 - arc) + Math.min(255, channels[k] * .6 + 100) * arc;
      rgba[4 * i + 3] = 148 + 35 * rim + 55 * arc;
      depth[i] = z;
      groups[i] = id;
    }
  }
  // Ink the outside silhouette and the seams where two box faces (or the
  // cone and its cap) meet. Smooth round surfaces share a single face group.
  for (let y = 1; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) {
    const i = y * cols + x,
      id = groups[i];
    if (!id) continue;
    const l = groups[i - 1],
      r = groups[i + 1],
      t = groups[i - cols],
      b = groups[i + cols];
    const rim = !l || !r || !t || !b;
    if (!rim && id === l && id === t) continue;
    for (let k = 0; k < 3; k++) rgba[4 * i + k] = rim ? channels[k] * .84 + 28 : channels[k] * .52 + 120;
    rgba[4 * i + 3] = rim ? 222 : 224;
  }
  return {
    x: a.x + x0,
    y: a.y + y0,
    w: cols * pixel,
    h: rows * pixel,
    cols,
    rows,
    rgba
  };
}
