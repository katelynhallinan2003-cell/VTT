import type { Drawing, GridSettings, Rect, Vec } from '../types';
import { groundAt, zonesOf } from './height';
import { terrainEdges, withSightTerrain } from './terrainEdges';
import type { SightSegments } from './terrainSight';
import { resolveWalls } from './wallBrush';
import { fanTriangles, sightSegs, visibilityPolygon, wallMid, type Wall } from './walls';

/** What the sight solver needs to rebuild a scene's sight geometry anywhere (a worker included). */
export interface SightSceneData {
  /** drawings that can be ground (painted terrain, or a shape with a height) */
  draws: Drawing[];
  /** the walls stored with the scene */
  walls: Wall[];
  grid: GridSettings;
  maps: Rect[];
  gradient: boolean;
}

export const isGroundDrawing = (d: Drawing): boolean => d.k === 'terrain' || d.hz != null;

/** The same sight segments the board builds from the client's wall geometry. */
export function sightSceneSegs(s: SightSceneData): SightSegments {
  const zones = zonesOf(s.draws, s.grid);
  const edges = terrainEdges(zones, [], s.maps);
  const plan = resolveWalls(edges, s.walls);
  const list = [...plan.walls.values()].filter(w => !w.face);
  return withSightTerrain([...sightSegs(list, w => groundAt(zones, wallMid(w)) + w.h), ...plan.terrain], zones, plan.openings, s.gradient);
}

export interface SightViewer { x: number; y: number; r: number; alt?: number }
export interface SightAnswer {
  /** union of everything seen, as triangles (x,y pairs) */
  fill: Float32Array;
  /** per viewer: its outlines (closed x,y rings), or null when nothing was in its way (a plain circle) */
  shapes: (Float32Array[] | null)[];
  /** asked for with `lights`: each viewer's and each light's own ground, apart (for darkness and the glow of lights) */
  sources?: { viewers: Float32Array[]; lights: Float32Array[]; lightShapes: (Float32Array[] | null)[] };
}

const flat = (pts: Vec[]): Float32Array => {
  const out = new Float32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { out[2 * i] = pts[i].x; out[2 * i + 1] = pts[i].y; }
  return out;
};

export function circleTriangles(x: number, y: number, r: number): Float32Array {
  const n = Math.max(24, Math.min(256, Math.ceil(r / 3)));
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
    out.set([x, y, x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(b) * r, y + Math.sin(b) * r], i * 6);
  }
  return out;
}

/** What the viewers see, limited to `clip` (the screen and a margin) when given. With `lights`, each source apart as well. */
export function solveSight(segs: SightSegments, viewers: SightViewer[], clip?: Rect, lights?: SightViewer[]): SightAnswer {
  const one = (c: SightViewer): { fill: Float32Array; rings: Float32Array[] | null } => {
    if (c.r > 0 && (segs.length || segs.surface)) {
      const v = visibilityPolygon({ x: c.x, y: c.y }, c.r, segs, 64, c.alt, clip);
      if (!v.free) return { fill: v.fill ?? fanTriangles(c, v.poly), rings: [v.poly, ...v.faces].map(flat) };
    }
    return { fill: circleTriangles(c.x, c.y, Math.max(0, c.r)), rings: null };
  };
  const seen = viewers.map(one);
  const fills = seen.map(s => s.fill);
  const fill = fills.length === 1 && !lights ? fills[0] : new Float32Array(fills.reduce((n, f) => n + f.length, 0));
  if (fill !== fills[0] || fills.length !== 1) { let at = 0; for (const f of fills) { fill.set(f, at); at += f.length; } }
  const answer: SightAnswer = { fill, shapes: seen.map(s => s.rings) };
  if (lights) {
    const lit = lights.map(one);
    answer.sources = { viewers: fills, lights: lit.map(l => l.fill), lightShapes: lit.map(l => l.rings) };
  }
  return answer;
}
