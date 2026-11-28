import type { FogOp, GridSettings, Rect, Token, Vec } from '../types';
import { encodePoints, lineOp, polyOp } from './fog';
import { dayOf, dimOf, zonesOf } from './height';
import { hasPaintedLight, isLightMark, lightOf, paintLift, paintSeen, sightHeight, viewerOf, type LightSrc } from './light';
import { sightSceneSegs, type SightSceneData } from './sightScene';
import { standingSurface } from './terrain';
import { routeReveal, routeSamples, simplifyPoly } from './walls';
import { traceContours } from './walltrace';

export interface ExplorationScene extends SightSceneData { rect: Rect; edge: number }
interface Trail { token: Token; viewer?: string; routes: Vec[][]; grid: GridSettings }
export interface ExplorationJob { trails: Trail[]; dark: boolean; lamps: { token: Token; grid: GridSettings }[] }

function paper(w: number, h: number) {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    canvas, ctx,
    size(width: number, height: number) {
      canvas.width = width;
      canvas.height = height;
    },
  };
}

/** Reuse the scene geometry between walks. Only the small trail jobs change as scouts move. */
export function explorationScene(scene: ExplorationScene) {
  const ground = zonesOf(scene.draws, scene.grid);
  const segs = sightSceneSegs(scene);
  const painted = { day: dayOf(scene.draws, scene.grid), dim: dimOf(scene.draws, scene.grid), edge: scene.edge };
  const altitude = (token: Token, at: Vec) => sightHeight(token, standingSurface(ground, at));
  const scale = Math.min(1, 1400 / Math.max(1, scene.rect.w, scene.rect.h));
  const frame = {
    origin: { x: scene.rect.x, y: scene.rect.y }, scale,
    w: Math.max(1, Math.ceil(scene.rect.w * scale)), h: Math.max(1, Math.ceil(scene.rect.h * scale)),
  };
  let lift: OffscreenCanvas | null = null;

  function illuminated(trail: Trail, points: Vec[], lights: LightSrc[]): FogOp | null {
    if (!lift && hasPaintedLight(painted)) {
      const layer = paper(frame.w, frame.h);
      paintLift(layer.ctx, frame, painted, 'dark', false, segs, { a: paper(1, 1), c: paper(1, 1) });
      lift = layer.canvas;
    }
    const viewers = points.map(p => viewerOf(trail.token, trail.grid, p, altitude(trail.token, p))!);
    const seen = paper(frame.w, frame.h), lit = paper(frame.w, frame.h);
    paintSeen(seen.ctx, lit.ctx, frame, lights, viewers, segs, lift);
    const rgba = seen.ctx.getImageData(0, 0, frame.w, frame.h).data;
    // The empty border closes outlines at the map edge. Keep all rings together
    // so an enclosed, unlit corner remains a hole when the memory is replayed.
    const stride = frame.w + 2;
    const mask = new Uint8Array(stride * (frame.h + 2));
    for (let y = 0; y < frame.h; y++) {
      for (let x = 0; x < frame.w; x++) {
        mask[(y + 1) * stride + x + 1] = rgba[(y * frame.w + x) * 4 + 3] > 127 ? 1 : 0;
      }
    }
    const rings = traceContours(mask, stride, frame.h + 2).map(ring => {
      const outline = simplifyPoly(ring.slice(0, -1), 0.5);
      return encodePoints(outline.map(p => ({
        x: frame.origin.x + (p.x - 1) / scale, y: frame.origin.y + (p.y - 1) / scale,
      })));
    });
    return rings.length ? { m: 'x', t: 'poly', p: rings.join(';') } : null;
  }

  return (job: ExplorationJob): FogOp[] => {
    const ops: FogOp[] = [];
    const lights = job.lamps.filter(({ token }) => !token.hidden || isLightMark(token))
      .map(({ token, grid }) => lightOf(token, grid, token, altitude(token, token)))
      .filter((light): light is LightSrc => !!light);

    for (const trail of job.trails) {
      const { token, grid } = trail;
      const viewer = viewerOf(token, grid, token, altitude(token, token));
      if (!viewer) continue;
      const ownLight = lights.find(l => l.id === token.id);
      const radius = job.dark ? Math.min(viewer.r, Math.max(viewer.touch, viewer.dv, ownLight?.r ?? 0)) : viewer.r;
      const externalLights = lights.filter(l => l.id !== token.id);
      const record = (op: FogOp) => ops.push(trail.viewer ? { ...op, viewer: trail.viewer } : op);
      for (const route of trail.routes) {
        for (const shape of routeReveal(route, radius, segs, grid.cell, p => altitude(token, p))) {
          record(shape.t === 'line' ? lineOp('x', shape.pts, shape.w) : polyOp('x', shape.pts));
        }
        if (job.dark && (externalLights.length || hasPaintedLight(painted))) {
          const lit = illuminated(trail, routeSamples(route, grid.cell), externalLights);
          if (lit) record(lit);
        }
      }
    }
    return ops;
  };
}
