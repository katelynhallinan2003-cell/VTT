// Height: the ground under a token (from the height zones the DM draws), how high a token is, and distances that count it.
import type { Drawing, GridSettings, Vec } from '../types';
import { groundAtTerrain, heightColor, terrainOf, type Terrain } from './terrain';

/** Quick heights to choose from when painting ground. */
export const ZONE_PRESETS = [-10, 5, 10, 15, 20, 30, 40, 60];

/** Everything that makes ground higher or lower on a map: brush-painted areas, and old-style boxes and circles. */
export type Zone = Terrain;
export const zonesOf = (draws: Iterable<Drawing>, grid: GridSettings): Terrain => terrainOf(draws, grid);

/** How high the ground is at a point, in feet. Painted areas are stacked bottom to top (each one sets the height or adds to it); no area means 0. */
export const groundAt = (zones: Terrain, p: Vec): number => groundAtTerrain(zones, p);

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

/** Fill colour for ground of a height: sand to brown as it gets higher, then pale rock; blue for pits. */
export const zoneColor = heightColor;

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
