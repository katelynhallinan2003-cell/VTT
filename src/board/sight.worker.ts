// Works out what tokens see off the main thread, so moving a token never waits for it.
import { sightSceneSegs, solveSight, type SightSceneData, type SightViewer } from '../core/sightScene';
import type { SightSegments } from '../core/terrainSight';
import type { Rect } from '../types';

let scene: { key: string; segs: SightSegments } | null = null;
type Msg = { t: 'scene'; key: string; data: SightSceneData } | { t: 'solve'; seq: number; key: string; viewers: SightViewer[]; clip?: Rect; lights?: SightViewer[] };
self.onmessage = ({ data }: MessageEvent<Msg>) => {
  if (data.t === 'scene') { scene = { key: data.key, segs: sightSceneSegs(data.data) }; return; }
  if (!scene || scene.key !== data.key) { self.postMessage({ t: 'stale', seq: data.seq }); return; }
  const t0 = performance.now();
  const answer = solveSight(scene.segs, data.viewers, data.clip, data.lights);
  const buffers = new Set<ArrayBufferLike>([answer.fill.buffer, ...answer.shapes.flatMap(s => s ? s.map(p => p.buffer) : [])]);
  if (answer.sources) for (const f of [...answer.sources.viewers, ...answer.sources.lights, ...answer.sources.lightShapes.flatMap(s => s ?? [])]) buffers.add(f.buffer);
  const transfer = [...buffers] as ArrayBuffer[];
  self.postMessage({ t: 'sight', seq: data.seq, key: data.key, ms: performance.now() - t0, ...answer }, { transfer });
};
