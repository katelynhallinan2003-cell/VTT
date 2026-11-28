import { spellPicture, type PictureRequest, type SpellPicture } from '../core/spellPicture';
import type { SpellScene } from './spell.worker';
import type { SpellWorld } from '../core/spellVolume';
import type { GridSettings, Vec } from '../types';
interface Job {
  slot: string;
  key: string;
  req: PictureRequest;
}
export interface PictureView {
  picture?: SpellPicture;
  current: boolean;
}
/** One outstanding calculation and one latest position per template. Saved shapes
 * keep their own result; a moving template can show its last completed fill. */
class PictureQueue {
  private worker?: Worker;
  private busy?: Job;
  private waiting = new Map<string, Job>();
  readonly shown = new Map<string, {
    key: string;
    picture: SpellPicture;
  }>();
  private scene = '';
  private sent = false;
  private local = typeof Worker === 'undefined';
  constructor(private snapshot: () => SpellScene, private localWorld: () => {
    world: SpellWorld;
    grid: GridSettings;
  }, private changed: (slot: string) => void) {}
  request(scene: string, slot: string, req: PictureRequest): PictureView {
    if (this.scene !== scene) {
      this.reset();
      this.scene = scene;
    }
    const key = JSON.stringify(req);
    const last = this.shown.get(slot);
    if (last?.key === key) {
      if (this.busy?.slot === slot && this.busy.key !== key) this.busy.slot = '';
      this.waiting.delete(slot);
      return {
        picture: last.picture,
        current: true
      };
    }
    if (this.local) {
      const {
          grid,
          world
        } = this.localWorld(),
        picture = spellPicture(req, grid, world);
      this.shown.set(slot, {
        key,
        picture
      });
      return {
        picture,
        current: true
      };
    }
    if (this.busy?.slot === slot && this.busy.key === key) this.waiting.delete(slot);else this.waiting.set(slot, {
      slot,
      key,
      req
    });
    this.pump();
    return {
      picture: last?.picture,
      current: false
    };
  }
  forget(slot: string) {
    this.shown.delete(slot);
    this.waiting.delete(slot);
    if (this.busy?.slot === slot) this.busy.slot = '';
  }
  reset() {
    this.worker?.terminate();
    this.worker = undefined;
    this.busy = undefined;
    this.sent = false;
    this.waiting.clear();
    this.shown.clear();
  }
  get idle() {
    return !this.busy && !this.waiting.size;
  }
  private fail() {
    const retry = [...this.waiting.keys()];
    if (this.busy?.slot) retry.push(this.busy.slot);
    this.reset();
    this.local = true;
    for (const slot of retry) this.changed(slot);
  }
  warm(scene: string) {
    if (this.scene !== scene) {
      this.reset();
      this.scene = scene;
    }
    if (this.local || this.sent) return;
    try {
      this.open();
      this.worker!.postMessage({
        scene: this.snapshot()
      });
      this.sent = true;
    } catch {
      this.fail();
    }
  }
  private open() {
    if (!this.worker) {
      const w = new Worker(new URL('./spell.worker.ts', import.meta.url), {
        type: 'module'
      });
      w.onmessage = ({
        data
      }: {
        data: SpellPicture;
      }) => {
        if (this.worker !== w) return;
        const done = this.busy;
        this.busy = undefined;
        if (done?.slot) {
          this.shown.set(done.slot, {
            key: done.key,
            picture: data
          });
          this.changed(done.slot);
        }
        this.pump();
      };
      w.onerror = e => {
        e.preventDefault();
        if (this.worker === w) this.fail();
      };
      w.onmessageerror = () => {
        if (this.worker === w) this.fail();
      };
      this.worker = w;
    }
  }
  private pump() {
    if (this.busy || !this.waiting.size) return;
    const job = this.waiting.get('preview') ?? this.waiting.values().next().value!;
    this.waiting.delete(job.slot);
    this.busy = job;
    try {
      this.open();
      this.worker!.postMessage({
        scene: this.sent ? undefined : this.snapshot(),
        req: job.req
      });
      this.sent = true;
    } catch {
      this.fail();
    }
  }
}

/** A full-resolution cast can still be finishing when the player immediately
 * casts again. Give pointer-driven work its own worker and terrain cache. */
export class SpellPainter {
  private live: PictureQueue;
  private saved: PictureQueue;
  private scene = '';
  constructor(snapshot: () => SpellScene, localWorld: () => {
    world: SpellWorld;
    grid: GridSettings;
  }, changed: (slot: string) => void) {
    this.live = new PictureQueue(snapshot, localWorld, changed);
    this.saved = new PictureQueue(snapshot, localWorld, changed);
  }
  request(scene: string, slot: string, req: PictureRequest): PictureView {
    if (this.scene !== scene) {
      this.reset();
      this.scene = scene;
    }
    const queue = req.fast ? this.live : this.saved;
    const result = queue.request(scene, slot, req);
    if (!req.fast && result.current && req.spell.spell?.stick) this.live.forget(slot);
    if (!req.fast && !result.current) {
      // After a height edit the old footprint would claim the wrong targets.
      // A placement preview is reusable only if it depicts this exact cast.
      const preview=this.live.shown.get(slot);
      result.picture=preview?.key===JSON.stringify({...req,fast:true}) ? preview.picture : undefined;
    } else if(req.fast && !result.picture) {
      const saved=this.saved.shown.get(slot)?.picture;
      // A gridless final mesh can contain thousands of triangles. Rebuilding
      // that old mesh on every pointer frame is slower than the live solve.
      if (saved?.movingSurface) result.picture={...saved,surface:saved.movingSurface,composed:true};
      else if (!saved?.triangles.length) result.picture=saved;
    }
    return result;
  }
  warm(scene: string) {
    if (this.scene !== scene) {
      this.reset();
      this.scene = scene;
    }
    this.live.warm(scene);
  }
  surfaceAt(id: string, p: Vec) {
    const img = this.saved.shown.get(id)?.picture.surface;
    if (!img) return false;
    const x = Math.floor((p.x - img.x) * img.cols / img.w),
      y = Math.floor((p.y - img.y) * img.rows / img.h);
    return x >= 0 && y >= 0 && x < img.cols && y < img.rows && img.rgba[(y * img.cols + x) * 4 + 3] > 0;
  }
  placed(id: string) {
    const last = this.live.shown.get('preview');
    if (last) this.live.shown.set(id, last);
  }
  forget(id: string) {
    this.live.forget(id);
    this.saved.forget(id);
  }
  reset() {
    this.live.reset();
    this.saved.reset();
  }
  get idle() {
    return this.live.idle && this.saved.idle;
  }
}
