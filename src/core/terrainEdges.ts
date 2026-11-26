import clip, { type MultiPolygon, type Pair, type Polygon } from 'polygon-clipping';
import type { GridSettings, Vec } from '../types';
import { cellPoly } from './cells';
import { paintedCliffBlocks } from './terrainMovement';
import { type Terrain, type TStroke } from './terrain';
import { type Seg } from './walls';

export interface TerrainEdge extends Seg { low: number; top: number; stair: boolean; one: 1 | -1 }
const pair = (p: Vec): Pair => [p.x, p.y];

function footprint(s: TStroke, grid: GridSettings): MultiPolygon {
  const { x, y, w, h } = s.b;
  if (s.kind === 'rect') return [[[[x,y], [x+w,y], [x+w,y+h], [x,y+h]]]];
  const shapes: Polygon[] = [];
  const oval = (p: Vec, rx: number, ry: number) => {
    const tolerance = grid.cell / 600;
    const angle = Math.acos(1 - Math.min(1, tolerance / Math.max(rx, ry, 0.01)));
    const count = Math.min(512, Math.max(4, 4 * Math.ceil(Math.PI / (4 * angle))));
    shapes.push([Array.from({length: count}, (_, i): Pair => {
      const a = 2 * Math.PI * i / count;
      return [p.x + rx * Math.cos(a), p.y + ry * Math.sin(a)];
    })]);
  };
  if (s.kind === 'cells') {
    for (const p of s.pts) shapes.push([cellPoly(grid, p).map(pair)]);
  } else if (s.kind === 'ellipse') {
    oval({ x: x + w / 2, y: y + h / 2 }, w / 2, h / 2);
  } else {
    s.pts.forEach((p, i) => {
      oval(p, s.r, s.r);
      if (!i) return;
      const q = s.pts[i - 1], len = Math.hypot(p.x - q.x, p.y - q.y);
      if (!len) return;
      const nx = (p.y - q.y) * s.r / len, ny = (q.x - p.x) * s.r / len;
      shapes.push([[[q.x+nx,q.y+ny],[p.x+nx,p.y+ny],[p.x-nx,p.y-ny],[q.x-nx,q.y-ny]]]);
    });
  }
  return shapes.length ? clip.union(shapes) : [];
}

/** Fold the paint in drawing order, retaining the boundaries of each finished elevation. */
function heightRegions(t: Terrain) {
  let regions = new Map<number, MultiPolygon>();
  const footprints = new Map<TStroke, MultiPolygon>();
  for (const area of t.areas) {
    let mask: MultiPolygon = [];
    for (const s of area.strokes) {
      let shape = footprints.get(s);
      if (!shape) { shape = footprint(s, t.grid); footprints.set(s, shape); }
      mask = s.erase ? clip.difference(mask, shape) : clip.union(mask, shape);
    }
    if (!mask.length) continue;
    const next = new Map<number, MultiPolygon>();
    const add = (z: number, shape: MultiPolygon) => {
      if (!z || !shape.length) return;
      const current = next.get(z);
      next.set(z, current ? clip.union(current, shape) : shape);
    };
    let bare = mask;
    for (const [z, region] of regions) {
      add(z, clip.difference(region, mask));
      if (area.add) {
        add(z + area.h, clip.intersection(region, mask));
        bare = clip.difference(bare, region);
      }
    }
    add(area.h, bare);
    regions = next;
  }
  return regions;
}

/** Sweep both sides of each contour line together. This splits a long edge wherever
 * a neighbouring terrace ends, even when the polygon on the opposite side has no vertex there. */
export function terrainEdges(t: Terrain, threshold: number): TerrainEdge[] {
  type Event = { s: number; left: number; right: number };
  const lines = new Map<string, { ux: number; uy: number; offset: number; events: Event[] }>();
  for (const [height, region] of heightRegions(t)) for (const polygon of region) for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const [x,y] = ring[i-1], [x2,y2] = ring[i];
      const len = Math.hypot(x2-x,y2-y);
      if (len < 1e-6) continue;
      const sign = x2 > x || (x2 === x && y2 > y) ? 1 : -1;
      const ux = (x2-x) / len * sign, uy = (y2-y) / len * sign, offset = ux*y-uy*x;
      const key = [Math.round(ux*1e8), Math.round(uy*1e8), Math.round(offset*1e5)].join(',');
      let line = lines.get(key);
      if (!line) { line = {ux, uy, offset, events: []}; lines.set(key,line); }
      const s = ux*x+uy*y, e = ux*x2+uy*y2;
      const left = sign > 0 ? height : 0, right = sign < 0 ? height : 0;
      line.events.push({s: Math.min(s,e), left, right}, {s: Math.max(s,e), left: -left, right: -right});
    }
  }
  const out: TerrainEdge[] = [];
  for (const {ux,uy,offset,events} of lines.values()) {
    events.sort((a,b) => a.s-b.s);
    let left = 0, right = 0;
    const at = (s: number, n = 0) => ({x: ux*s-uy*(offset+n), y: uy*s+ux*(offset+n)});
    for (let i = 0; i+1 < events.length; i++) {
      left += events[i].left; right += events[i].right;
      const start = events[i].s, len = events[i+1].s-start;
      if (left === right || len < 1e-6) continue;
      const one = left < right ? 1 : -1;
      const low = Math.min(left,right), top = Math.max(left,right);
      const pieces = Math.max(1, Math.ceil(len / t.grid.cell));
      for (let j = 0; j < pieces; j++) {
        const mid = start + (j+0.5)*len/pieces;
        const probe = one * t.grid.cell * 0.004;
        const wall = threshold > 0 && (top-low > Math.max(5,threshold) || (t.areas.length > 1
          && paintedCliffBlocks(t,at(mid,probe),at(mid,-probe),threshold)));
        out.push({ a: at(start+j*len/pieces), b: at(start+(j+1)*len/pieces), one, low, top, stair: !wall });
      }
    }
  }
  return out;
}
