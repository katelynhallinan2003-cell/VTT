import { sightSceneSegs, solveSight, type SightAnswer, type SightSceneData, type SightViewer } from '../core/sightScene';
import type { SightSegments } from '../core/terrainSight';
import type { Rect } from '../types';

export interface SightRequest { viewers: SightViewer[]; clip?: Rect; tag: string; lights?: SightViewer[]; /** handed back with the answer */ ctx?: unknown }
export interface SightResult extends SightAnswer, SightRequest { scene: string; ms: number }

/**
 * Runs the sight solver in a worker so the board keeps drawing while it works. Only the newest request waits: a request
 * made while the worker is busy replaces any older one still waiting. Without workers it answers at once on this thread.
 */
export class SightSolver {
  private worker: Worker | null = null;
  private local = typeof Worker === 'undefined';
  private scene = '';
  private data: (() => SightSceneData) | null = null;
  private sent = '';
  private busy: (SightRequest & { seq: number; scene: string }) | null = null;
  private waiting: SightRequest | null = null;
  private seq = 0;

  constructor(private answer: (r: SightResult) => void, private segs: () => SightSegments) {}

  /** The scene the next requests are about; `data` is read only when the worker needs it. */
  setScene(key: string, data: () => SightSceneData) {
    if (key === this.scene) return;
    this.scene = key;
    this.data = data;
  }

  request(r: SightRequest) {
    this.waiting = r;
    this.pump();
  }

  /** Nothing asked for is still being worked out. */
  get idle(): boolean { return !this.busy && !this.waiting; }

  private start(): Worker | null {
    if (this.local) return null;
    if (this.worker) return this.worker;
    try {
      const w = new Worker(new URL('./sight.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent) => this.received(e.data);
      w.onerror = (e) => { e.preventDefault(); this.fallBack(); };
      w.onmessageerror = () => this.fallBack();
      this.worker = w;
      return w;
    } catch { this.fallBack(); return null; }
  }

  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    this.local = true;
    const job = this.busy;
    this.busy = null;
    if (job && !this.waiting) this.waiting = job;
    queueMicrotask(() => this.pump());
  }

  private pump() {
    if (this.busy || !this.waiting) return;
    const job = this.waiting;
    this.waiting = null;
    const w = this.start();
    if (!w) {
      const t0 = performance.now();
      const answer = solveSight(this.segs(), job.viewers, job.clip, job.lights);
      this.answer({ ...job, ...answer, scene: this.scene, ms: performance.now() - t0 });
      return;
    }
    if (this.sent !== this.scene && this.data) {
      w.postMessage({ t: 'scene', key: this.scene, data: this.data() });
      this.sent = this.scene;
    }
    this.busy = { ...job, seq: ++this.seq, scene: this.scene };
    w.postMessage({ t: 'solve', seq: this.seq, key: this.scene, viewers: job.viewers, clip: job.clip, lights: job.lights });
  }

  private received(m: { t: 'sight' | 'stale'; seq: number; key: string; ms: number } & SightAnswer) {
    const job = this.busy;
    if (!job || m.seq !== job.seq) return;
    this.busy = null;
    if (m.t === 'stale') {
      // The worker was not told about this scene yet (or lost it): tell it, then ask again.
      this.sent = '';
      if (!this.waiting && job.scene === this.scene) this.waiting = job;
    } else if (job.scene === this.scene) {
      this.answer({ viewers: job.viewers, clip: job.clip, tag: job.tag, lights: job.lights, ctx: job.ctx, fill: m.fill, shapes: m.shapes, sources: m.sources, scene: job.scene, ms: m.ms });
    }
    this.pump();
  }

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.waiting = null;
    this.busy = null;
  }
}
