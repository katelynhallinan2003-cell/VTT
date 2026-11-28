import { Container, RenderTexture, Sprite, Text, type Renderer, type Texture } from 'pixi.js';
import { areaLabelAt, heightColor, type Terrain } from '../core/terrain';
import { paintTerrain, type TerrainRaster } from './terrainRaster';
import type { Rect } from '../types';
import { canvasTexture } from './textures';

/**
 * Paints all the high and low ground as one soft picture: a light tint by height (ground that adds to ground shows its total), a shadow
 * that falls on the lower side of every drop and a faint highlight on the upper side, and a thin line wherever the height changes.
 * Areas that are selected get a bright outline. The picture is rebuilt only when the ground, the grid or the selection changes.
 */
export class TerrainLayer {
  readonly container = new Container();
  private sprite: Sprite | null = null;
  private tex: Texture | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private worker:Worker|null=null;
  private local=false;
  private running=false;
  private version=0;
  private latest:{terrain:Terrain;selected:Set<string>;version:number}|null=null;
  constructor(private invalidate:()=>void, private renderer:()=>Renderer) {}
  private labels = new Map<number, Text>();
  private labelBoxes: (Rect & { elevation: number })[] = [];
  private zoom = 1;
  private coveredLabels: Text[] = [];
  private key = '';
  private terrain?:Terrain;
  private levels: number[] = [];

  colourAt(h: number): string { return heightColor(h, this.levels.length ? this.levels : undefined); }

  /** `selected` holds the ids of the areas to outline. Nothing is built while the layer is hidden. */
  sync(t: Terrain, selected: Set<string>, show: boolean, warm = false) {
    this.container.visible = show;
    if (!show && !warm) return;
    const key = [...selected].sort().join(',');
    if (this.terrain === t && key === this.key) return;
    if (!t.areas.length) { this.reset(); this.key=key; this.terrain=t; return; }
    this.key = key;
    this.terrain = t;
    this.latest={terrain:t,selected,version:++this.version};
    if (!this.running) this.renderLatest();
  }

  private renderLatest() {
    const job=this.latest;
    if (!job) return;
    if (!this.local && typeof Worker!=='undefined' && typeof OffscreenCanvas!=='undefined') {
      try {
        this.worker ??= new Worker(new URL('./terrainRaster.worker.ts',import.meta.url),{type:'module'});
        this.running=true;
        this.worker.onmessage=(e:MessageEvent<TerrainRaster>)=>{
          this.running=false;
          if (job.version===this.version) { this.latest=null; this.present(e.data); }
          else this.renderLatest();
        };
        this.worker.onerror=(e)=>{
          e.preventDefault();
          this.worker?.terminate(); this.worker=null; this.running=false; this.local=true;
          this.renderLatest();
        };
        this.worker.postMessage({terrain:{...job.terrain,sig:''},selected:job.selected});
        return;
      } catch { this.worker?.terminate(); this.worker=null; this.running=false; this.local=true; }
    }
    const raster=paintTerrain(job.terrain,job.selected,(w,h)=>{
      const mask=document.createElement('canvas');
      mask.width=w; mask.height=h;
      return mask.getContext('2d',{willReadFrequently:true})!;
    });
    this.latest=null;
    this.present(raster);
  }

  private present({out,boxes,levels,bx,by,s}:TerrainRaster) {
    const W=out.width, H=out.height;
    this.levels=levels;
    if (!this.canvas || this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = W; this.canvas.height = H;
      this.tex?.destroy(true);
      this.tex = canvasTexture(this.canvas);
      if (!this.sprite) { this.sprite = new Sprite(this.tex); this.container.addChildAt(this.sprite, 0); } else this.sprite.texture = this.tex;
    }
    this.canvas.getContext('2d')!.putImageData(out, 0, 0);
    this.tex!.source.update();
    this.sprite!.position.set(bx, by);
    this.sprite!.scale.set(1 / s);
    this.sprite!.visible = true;

    this.labelBoxes=boxes;
    this.invalidate();
    this.layoutLabels();
    // Prepare the overlay and its text while hidden. The first drag only
    // changes opacity and can reuse the same GPU assets as later moves.
    if (!this.container.visible) {
      const target=RenderTexture.create({width:1,height:1});
      const alpha=this.container.alpha;
      try {
        this.container.visible=true;
        this.container.alpha=1;
        this.renderer().render({container:this.container,target,clear:true});
      } finally {
        this.container.visible=false;
        this.container.alpha=alpha;
        target.destroy(true);
      }
    }
  }

  setZoom(zoom: number) {
    if (this.zoom === zoom) return;
    this.zoom = zoom;
    this.layoutLabels();
  }

  private layoutLabels() {
    const zoom = this.zoom;
    const seen = new Set<number>();
    for (let i = 0; i < this.labelBoxes.length; i++) {
      const box = this.labelBoxes[i];
      if (box.w * zoom < 24 || box.h * zoom < 13) continue;
      let tx = this.labels.get(i);
      if (!tx) {
        tx = new Text({ style: { fontFamily: 'system-ui, sans-serif', fontWeight: '600', fontSize: 14, fill: 0xffffff, stroke: { color: 0x18191d, width: 3, join: 'round' } } });
        tx.anchor.set(0.5);
        tx.resolution = Math.max(1, window.devicePixelRatio || 1);
        this.container.addChild(tx);
        this.labels.set(i, tx);
      }
      tx.text = areaLabelAt(box.elevation);
      const bounds = tx.getLocalBounds();
      const scale = Math.min(1 / zoom, (box.w - 4 / zoom) / bounds.width, (box.h - 4 / zoom) / bounds.height);
      if (scale * zoom < 0.75) continue;
      tx.scale.set(scale);
      tx.position.set(box.x + box.w / 2, box.y + box.h / 2);
      seen.add(i);
    }
    for (const [i, tx] of this.labels) if (!seen.has(i)) { tx.destroy(); this.labels.delete(i); }
  }

  /** The brush readout shares world coordinates with the terrain labels and takes precedence while painting. */
  avoidBrushReadout(readout?: Text) {
    for (const label of this.coveredLabels) if (!label.destroyed) label.renderable = true;
    this.coveredLabels.length = 0;
    if (!readout) return;
    const halfWidth = readout.width / 2 + 2 / this.zoom;
    const top = readout.y - readout.height - 2 / this.zoom;
    for (const label of this.labels.values()) {
      if (Math.abs(label.x - readout.x) >= halfWidth + label.width / 2 ||
          label.y + label.height / 2 <= top || label.y - label.height / 2 >= readout.y + 2 / this.zoom) continue;
      label.renderable = false;
      this.coveredLabels.push(label);
    }
  }

  reset() {
    this.version++;
    this.latest=null;
    this.key='';
    this.terrain=undefined;
    this.levels=[];
    if (this.sprite) this.sprite.visible = false;
    for (const tx of this.labels.values()) tx.destroy();
    this.labels.clear();
    this.labelBoxes = [];
  }

  destroy() {
    this.worker?.terminate();
    this.latest=null;
    this.container.destroy({ children: true });
    this.tex?.destroy(true);
  }
}
