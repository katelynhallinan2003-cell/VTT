// Height: the ground under a token (from the height zones the DM draws), how high a token is, and distances that count it.
import type { Drawing, Rect, Vec } from '../types';
import { boundsOf, parsePts } from './draw';

export interface Zone { id: string; shape: 'rect' | 'ellipse'; b: Rect; h: number }

/** Quick heights to choose from when drawing ground. */
export const ZONE_PRESETS = [-10, 5, 10, 15, 20, 30, 40, 60];

/** The boxes and circles that have a height. */
export function zonesOf(draws: Iterable<Drawing>): Zone[] {
  const out: Zone[] = [];
  for (const d of draws) {
    if (d.hz == null || (d.k !== 'rect' && d.k !== 'ellipse')) continue;
    const pts = parsePts(d.p);
    if (pts.length < 2) continue;
    out.push({ id: d.id, shape: d.k, b: boundsOf(pts), h: d.hz });
  }
  return out;
}

export function zoneHas(z: Zone, p: Vec): boolean {
  const { x, y, w, h } = z.b;
  if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) return false;
  if (z.shape === 'rect') return true;
  const rx = Math.max(1e-6, w / 2);
  const ry = Math.max(1e-6, h / 2);
  return ((p.x - (x + rx)) / rx) ** 2 + ((p.y - (y + ry)) / ry) ** 2 <= 1;
}

/** How high the ground is at a point, in feet. Where zones overlap the smallest one wins (a nest drawn inside a cliff); no zone means 0. */
export function groundAt(zones: readonly Zone[], p: Vec): number {
  let best: Zone | null = null;
  let bestArea = Infinity;
  for (const z of zones) {
    if (!zoneHas(z, p)) continue;
    const area = z.b.w * z.b.h;
    if (area < bestArea || (area === bestArea && best && z.h > best.h)) { best = z; bestArea = area; }
  }
  return best ? best.h : 0;
}

export interface Altitude {
  /** feet above the map's base level */
  alt: number;
  /** feet above the ground right under it (0 when it is standing) */
  clear: number;
  /** how high the ground is there */
  ground: number;
}

/** A walking token stands on the ground. A flying one keeps its altitude, but never sinks into the ground. */
export function altitudeOf(t: { fly: boolean; elev: number }, ground: number): Altitude {
  const alt = t.fly ? Math.max(t.elev, ground) : ground;
  return { alt, clear: alt - ground, ground };
}

/** Fill colour for a zone: sand to brown as the ground gets higher, then pale rock; blue for pits. */
export function zoneColor(h: number): string {
  const mix = (a: number[], b: number[], k: number) => '#' + a.map((v, i) => Math.round(v + (b[i] - v) * Math.max(0, Math.min(1, k))).toString(16).padStart(2, '0')).join('');
  if (h < 0) return mix([0x8f, 0xb4, 0xf5], [0x2b, 0x4a, 0x9e], -h / 40);
  if (h === 0) return '#a8b0ba';
  if (h <= 60) return mix([0xe8, 0xc9, 0x8a], [0x7a, 0x4a, 0x1e], h / 60);
  return mix([0x7a, 0x4a, 0x1e], [0xd5, 0xda, 0xe0], (h - 60) / 120);
}

/** What the altitude badge says: ↑ for something in the air, ▲ for high ground, ▼ for low ground. */
export function altLabel(a: Altitude, flying: boolean): string {
  if (a.alt === 0 && a.clear === 0) return '';
  if (flying && a.clear > 0) return `↑${a.alt}`;
  return `${a.alt > 0 ? '▲' : '▼'}${Math.abs(a.alt)}`;
}

/** 5e falling damage: 1d6 for every 10 feet, up to 20d6. */
export function fallDice(ft: number): number {
  return Math.max(0, Math.min(20, Math.floor(ft / 10)));
}

/** "falls 30 ft (3d6)" or "climbs 10 ft" for a change in height, or '' when it is small. */
export function heightChangeNote(fromAlt: number, toAlt: number): string {
  const d = toAlt - fromAlt;
  if (Math.abs(d) < 1) return '';
  if (d > 0) return `climbs ${d} ft`;
  const dice = fallDice(-d);
  return dice ? `drops ${-d} ft (${dice}d6 if it falls)` : `drops ${-d} ft`;
}

/** The move needed to put a token at `alt` feet while flying. Landing (at or below the ground) turns flying off. */
export function setAltitude(alt: number, ground: number): { fly: boolean; elev: number } {
  const a = Math.round(alt);
  return a <= ground ? { fly: false, elev: 0 } : { fly: true, elev: a };
}

/** " (30 across, 20 up)" for a measurement with a height difference, or nothing. */
export function heightNote(across: number, up: number): string {
  return up ? ` (${across} across, ${Math.abs(up)} ${up > 0 ? 'up' : 'down'})` : '';
}
