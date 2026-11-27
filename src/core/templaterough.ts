// A spell template can be marked difficult ground (Spike Growth, Entangle, a web): the squares it covers slow whoever walks through them,
// for as long as the template is on the map. They are turned into strokes of difficult ground, so everything that already understands
// difficult ground (the hatching, the cost of a move, the drag readout) understands these too, with no second code path.

import type { Drawing, GridSettings, Vec } from '../types';
import { spellVolume } from './spellVolume';
import { isTemplate, joinPts, parsePts } from './draw';
import { type Seg } from './walls';

export const TEMPLATE_ROUGH_PREFIX = 'tpl:';

/**
 * One stroke of difficult ground for each template that is marked difficult, covering the squares the template covers (the ones a spell
 * can reach: a wall that stops the spell stops the difficult ground too, the same squares the map lights up).
 * `sight` and `groundAt` are what `reachableCells` takes.
 */
export function templateRoughDraws(draws: Iterable<Drawing>, grid: GridSettings, sight?: Seg[], groundAt?: (p: Vec) => number, maps?:import('../types').Rect[]): Drawing[] {
  const out: Drawing[] = [];
  for (const d of draws) {
    if (!d.td || !isTemplate(d.k)) continue;
    const pts = parsePts(d.p);
    if (pts.length < 2) continue;
    const cells = spellVolume(d,pts[0],pts[1],grid,{segs:sight ?? [],ground:groundAt,maps}).cells(grid,true);
    if (!cells.length) continue;
    const id = TEMPLATE_ROUGH_PREFIX + d.id;
    out.push({
      id, uid: d.uid, k: 'terrain', p: joinPts(cells), color: d.color, w: grid.cell, fill: 0, fc: '', dash: false, txt: '', fs: 28, font: '',
      b: false, i: false, u: false, ho: false, bw: 5, hz: 1, hg: id, ha: false, he: false, hc: true, dt: true, t: d.t,
    });
  }
  return out;
}
