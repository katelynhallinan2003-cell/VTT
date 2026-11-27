import { Container, GlProgram, Mesh, MeshGeometry, Rectangle, RenderTexture, Shader, Sprite, Texture, type Renderer } from 'pixi.js';
import { NIGHT, SHADE, eraseStops, hasPaintedLight, paintLift, paintStrokes, type Frame, type LightSrc, type PaintedLight, type Scratch, type Viewer } from '../core/light';
import type { Terrain } from '../core/terrain';
import type { Seg } from '../core/walls';
import type { Ambient, Rect, Vec } from '../types';
import { canvasTexture } from './textures';

/** A canvas, the texture on it, and the sprite that shows it. */
class Paper {
  readonly canvas = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  readonly sprite = new Sprite(Texture.EMPTY);
  private size = '';
  private tex: Texture | null = null;

  /** `readable`: single pixels will be read back from it now and then */
  constructor(readable = false) {
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: readable })!;
  }

  /** Make it `w` x `h` and put it at `origin`, `scale` canvas pixels to each world pixel. True when it was remade (so it is blank). */
  fit(w: number, h: number, origin: Vec, scale: number): boolean {
    this.sprite.position.set(origin.x, origin.y);
    this.sprite.scale.set(1 / scale);
    const key = `${w}x${h}`;
    if (key === this.size) return false;
    this.size = key;
    this.canvas.width = w;
    this.canvas.height = h;
    const old = this.tex;
    this.tex = canvasTexture(this.canvas);
    this.sprite.texture = this.tex;
    old?.destroy(true);
    return true;
  }

  upload() { this.tex?.source.update(); }

  destroy() {
    this.sprite.destroy();
    this.tex?.destroy(true);
    this.tex = null;
  }
}

/** A plain canvas to work on (read back now and then), one per job. */
class Work implements Scratch {
  readonly canvas = document.createElement('canvas');
  readonly ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  size(w: number, h: number) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }
}

const vertex = `
in vec2 aPosition;
out vec2 vWorld;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vWorld = aPosition;
}`;

// A radial gradient through up to eight stops, cut off past its radius, like
// a canvas radial gradient filling a shape no bigger than its circle.
const radialFragment = `
precision highp float;
in vec2 vWorld;
out vec4 finalColor;
uniform vec2 uCenter;
uniform float uRadius;
uniform vec4 uAt0;
uniform vec4 uAt1;
uniform vec4 uA0;
uniform vec4 uA1;
uniform float uCount;
uniform vec3 uRgb;
float pick(vec4 a, vec4 b, int i) {
  if (i == 0) return a.x; if (i == 1) return a.y; if (i == 2) return a.z; if (i == 3) return a.w;
  if (i == 4) return b.x; if (i == 5) return b.y; if (i == 6) return b.z; return b.w;
}
float stopAt(int i) { return pick(uAt0, uAt1, i); }
float alphaAt(int i) { return pick(uA0, uA1, i); }
void main() {
  float t = length(vWorld - uCenter) / max(uRadius, 1e-6);
  if (t > 1.0) discard;
  int n = int(uCount);
  float a = alphaAt(0);
  for (int i = 1; i < 8; i++) {
    if (i >= n) break;
    float p = stopAt(i - 1), q = stopAt(i);
    if (t >= p) a = t >= q ? alphaAt(i) : mix(alphaAt(i - 1), alphaAt(i), (t - p) / max(q - p, 1e-6));
  }
  finalColor = vec4(uRgb * a, a);
}`;

// Everything not lit, for cutting the unlit part out of what the viewers see.
const unlitFragment = `
precision highp float;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D uLit;
uniform vec4 uMap;
void main() {
  float lit = texture(uLit, (vWorld - uMap.xy) * uMap.zw).a;
  finalColor = vec4(1.0 - lit);
}`;

type Stops = [number, number][];
const DISK: Stops = [[0, 1], [1, 1]];

function setFill(geometry: MeshGeometry, fill: Float32Array) {
  const count = fill.length / 2;
  geometry.positions = fill;
  if (geometry.uvs.length !== fill.length) geometry.uvs = new Float32Array(fill.length);
  if (geometry.indices.length !== count) {
    const idx = new Uint32Array(count);
    for (let i = 0; i < count; i++) idx[i] = i;
    geometry.indices = idx;
  }
}

/** One shape drawn with a radial gradient: a mesh with a shader of its own. */
class Radial {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  constructor() {
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex, fragment: radialFragment, name: 'light-radial' }),
      resources: { radialUniforms: {
        uCenter: { value: new Float32Array(2), type: 'vec2<f32>' },
        uRadius: { value: 1, type: 'f32' },
        uAt0: { value: new Float32Array(4), type: 'vec4<f32>' },
        uAt1: { value: new Float32Array(4), type: 'vec4<f32>' },
        uA0: { value: new Float32Array(4), type: 'vec4<f32>' },
        uA1: { value: new Float32Array(4), type: 'vec4<f32>' },
        uCount: { value: 2, type: 'f32' },
        uRgb: { value: new Float32Array([1, 1, 1]), type: "vec3<f32>" },
      } },
    });
    this.mesh = new Mesh({ geometry: new MeshGeometry({ positions: new Float32Array(6), uvs: new Float32Array(6), indices: new Uint32Array([0, 1, 2]) }), shader });
  }
  set(fill: Float32Array, c: Vec, r: number, stops: Stops, color = [1, 1, 1], blend: 'normal' | 'erase' | 'add' = 'normal'): this {
    setFill(this.mesh.geometry, fill);
    const u = this.mesh.shader!.resources.radialUniforms.uniforms;
    u.uCenter[0] = c.x; u.uCenter[1] = c.y; u.uRadius = r;
    const n = Math.min(8, stops.length);
    for (let i = 0; i < 8; i++) {
      const [at, a] = stops[Math.min(i, n - 1)];
      (i < 4 ? u.uAt0 : u.uAt1)[i % 4] = at;
      (i < 4 ? u.uA0 : u.uA1)[i % 4] = a;
    }
    u.uCount = n;
    u.uRgb[0] = color[0]; u.uRgb[1] = color[1]; u.uRgb[2] = color[2];
    this.mesh.blendMode = blend;
    return this;
  }
}

/** Where a bounded texture sits on the map: origin, texture pixels per map pixel, and the part in use. */
export interface TexFrame { x: number; y: number; scale: number; w: number; h: number }

const MAX = 2048;

/** A fixed-size render texture, used through a window of `w` x `h` pixels. */
class Target {
  rt: RenderTexture | null = null;
  view: Texture = Texture.EMPTY;
  get(w: number, h: number): RenderTexture {
    if (!this.rt) this.rt = RenderTexture.create({ width: MAX, height: MAX, antialias: false });
    this.view = new Texture({ source: this.rt.source, frame: new Rectangle(0, 0, Math.min(MAX, w), Math.min(MAX, h)) });
    return this.rt;
  }
  destroy() { this.rt?.destroy(true); this.rt = null; }
}

const hexRgb = (c: string): number[] => {
  const n = parseInt(c.replace('#', ''), 16);
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : [1, 217 / 255, 160 / 255];
};
const NIGHT_RGB = NIGHT.split(',').map((v) => Number(v) / 255);

/** What the solver worked out for one dark frame: each light's and each viewer's ground (triangles in map coordinates). */
export interface DarkShapes { lights: LightSrc[]; lightFills: Float32Array[]; viewers: Viewer[]; viewerFills: Float32Array[] }

/**
 * Darkness and light on the board: a night wash with the lights cut out of it, a coloured glow where they shine, and, when it is
 * dark and the fog follows what tokens see, the shape of what the party can see (used to cut holes in the fog). All of it is
 * drawn on the GPU into textures that cover the screen and a margin, from shapes the sight worker sends.
 */
export class LightLayer {
  readonly container = new Container();
  private shadeT = new Target();
  private glowT = new Target();
  private litT = new Target();
  private seenT = new Target();
  private shade = new Sprite(Texture.EMPTY);
  private glow = new Sprite(Texture.EMPTY);
  private stage = new Container();
  private pool: Radial[] = [];
  private unlit: Mesh<MeshGeometry, Shader>;
  private liftSprite = new Sprite(Texture.EMPTY);
  /** the painted light: how much it lifts the dark (graded) and the plain lit shape (for sight), on the CPU, made only when it changes */
  private liftShade = new Work();
  private liftSeen = new Work();
  private liftShadeTex: Texture | null = null;
  private liftSeenTex: Texture | null = null;
  private liftKey = '';
  private liftFrame: Frame | null = null;
  private hasLift = false;
  private workA = new Work();
  private workC = new Work();
  /** the painted light shown as a tint while the DM paints it */
  readonly tint = new Container();
  private tintDay = new Paper();
  private tintDim = new Paper();
  private tintKey = '';
  /** the frame of the last drawn darkness */
  frame: TexFrame | null = null;

  constructor(private renderer: () => Renderer) {
    this.glow.blendMode = 'add';
    this.container.addChild(this.shade, this.glow);
    this.container.visible = false;
    this.tintDay.sprite.tint = 0xf2c230;
    this.tintDim.sprite.tint = 0x7aa2d8;
    this.tintDay.sprite.alpha = this.tintDim.sprite.alpha = 0.42;
    this.tint.addChild(this.tintDay.sprite, this.tintDim.sprite);
    this.tint.visible = false;
    this.unlit = new Mesh({
      geometry: new MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array(8), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) }),
      shader: new Shader({
        glProgram: GlProgram.from({ vertex, fragment: unlitFragment, name: 'light-unlit' }),
        resources: { uLit: Texture.EMPTY.source, unlitUniforms: { uMap: { value: new Float32Array(4), type: 'vec4<f32>' } } },
      }),
    });
  }

  hide() { this.container.visible = false; this.frame = null; }

  /** The painted light, worked out on the CPU over the whole scene and kept until the paint, the walls or the darkness change. */
  setPainted(painted: PaintedLight | null, ambient: Ambient, rect: Rect, segs: Seg[], key: string) {
    const on = hasPaintedLight(painted) ? painted : null;
    const k = `${key}|${ambient}|${rect.x},${rect.y},${rect.w},${rect.h}|${!!on}`;
    if (k === this.liftKey) return;
    this.liftKey = k;
    this.hasLift = !!on;
    if (!on) return;
    const scale = Math.min(1, 1400 / Math.max(rect.w, rect.h, 1));
    const f: Frame = { origin: { x: rect.x, y: rect.y }, scale, w: Math.max(1, Math.ceil(rect.w * scale)), h: Math.max(1, Math.ceil(rect.h * scale)) };
    this.liftFrame = f;
    this.liftShade.size(f.w, f.h);
    this.liftSeen.size(f.w, f.h);
    paintLift(this.liftShade.ctx, f, on, ambient, true, segs, { a: this.workA, c: this.workC });
    paintLift(this.liftSeen.ctx, f, on, 'dark', false, segs, { a: this.workA, c: this.workC });
    this.liftSprite.texture = Texture.EMPTY;
    this.liftShadeTex?.destroy(true);
    this.liftSeenTex?.destroy(true);
    this.liftShadeTex = canvasTexture(this.liftShade.canvas);
    this.liftSeenTex = canvasTexture(this.liftSeen.canvas);
  }

  private radial(i: number): Radial {
    while (this.pool.length <= i) this.pool.push(new Radial());
    return this.pool[i];
  }

  /** Render these meshes (and the painted light, if `lift`) into `target` at frame `f`. */
  private pass(target: Target, f: TexFrame, meshes: Container[], clear: number[], lift: Texture | null = null, liftBlend: 'normal' | 'erase' = 'normal') {
    const rt = target.get(f.w, f.h);
    this.stage.removeChildren();
    this.stage.position.set(-f.x * f.scale, -f.y * f.scale);
    this.stage.scale.set(f.scale);
    for (const m of meshes) this.stage.addChild(m);
    if (lift && this.liftFrame) {
      this.liftSprite.texture = lift;
      this.liftSprite.position.set(this.liftFrame.origin.x, this.liftFrame.origin.y);
      this.liftSprite.scale.set(1 / this.liftFrame.scale);
      this.liftSprite.blendMode = liftBlend;
      this.stage.addChild(this.liftSprite);
    }
    this.renderer().render({ container: this.stage, target: rt, clear: true, clearColor: clear as [number, number, number, number] });
    this.stage.removeChildren();
  }

  /** Paint the dark and the glow for the part of the map in `f`. `dm`: the DM's own view, which is see-through so the map can still be worked on. */
  draw(ambient: Ambient, s: DarkShapes, f: TexFrame, dm: boolean) {
    this.container.visible = true;
    this.frame = f;
    const base = SHADE[ambient];
    // the night wash, each light lifting it where it reaches, darkvision by half in the dark, and the painted light
    let n = 0;
    const lifts: Container[] = [];
    s.lights.forEach((l, i) => lifts.push(this.radial(n++).set(s.lightFills[i], l, l.r, eraseStops(l.b, l.r, ambient), [1, 1, 1], 'erase').mesh));
    if (ambient === 'dark') s.viewers.forEach((v, i) => { if (v.dv > 0) lifts.push(this.radial(n++).set(s.viewerFills[i], v, v.dv, [[0, .5], [.88, .5], [1, 0]], [1, 1, 1], 'erase').mesh); });
    this.pass(this.shadeT, f, lifts, [NIGHT_RGB[0] * base, NIGHT_RGB[1] * base, NIGHT_RGB[2] * base, base], this.hasLift ? this.liftShadeTex : null, 'erase');
    // a soft coloured glow where each light shines (a torch looks warm, a spell looks cold)
    const glows: Container[] = [];
    if (ambient !== 'bright') s.lights.forEach((l, i) => {
      const reach = l.b > 0 ? Math.min(l.r, l.b * 1.35) : l.r;
      glows.push(this.radial(n++).set(s.lightFills[i], l, Math.max(1, reach), [[0, .2], [.6, .1], [1, 0]], hexRgb(l.c), 'add').mesh);
    });
    this.pass(this.glowT, f, glows, [0, 0, 0, 0]);
    this.shade.texture = this.shadeT.view;
    this.glow.texture = this.glowT.view;
    for (const sprite of [this.shade, this.glow]) {
      sprite.position.set(f.x, f.y);
      sprite.scale.set(1 / f.scale);
    }
    this.shade.alpha = dm ? 0.62 : 1;
  }

  /**
   * What the party sees in the dark, as a texture of frame `f`: each viewer's sight where a light (or the painted light) reaches,
   * plus what its darkvision and its own touch give. The soft edge is added by the fog.
   */
  seen(s: DarkShapes, f: TexFrame): Texture {
    let n = 0;
    const lit = s.lights.map((l, i) => this.radial(n++).set(s.lightFills[i], l, l.r, DISK).mesh);
    this.pass(this.litT, f, lit, [0, 0, 0, 0], this.hasLift ? this.liftSeenTex : null, 'normal');
    // everything they could see, less what is not lit, plus what they see without light
    const sight = s.viewers.map((v, i) => this.radial(n++).set(s.viewerFills[i], v, v.r, DISK).mesh);
    const x1 = f.x + f.w / f.scale, y1 = f.y + f.h / f.scale;
    this.unlit.geometry.positions = new Float32Array([f.x, f.y, x1, f.y, x1, y1, f.x, y1]);
    const shader = this.unlit.shader!;
    shader.resources.uLit = this.litT.rt!.source;
    const u = shader.resources.unlitUniforms.uniforms;
    u.uMap[0] = f.x; u.uMap[1] = f.y; u.uMap[2] = f.scale / MAX; u.uMap[3] = f.scale / MAX;
    this.unlit.blendMode = 'erase';
    const own: Container[] = [];
    s.viewers.forEach((v, i) => { const r = Math.max(v.dv, v.touch); if (r > 0) own.push(this.radial(n++).set(s.viewerFills[i], v, r, DISK).mesh); });
    this.pass(this.seenT, f, [...sight, this.unlit, ...own], [0, 0, 0, 0]);
    return this.seenT.view;
  }

  /** Does the painted light make this spot visible in the dark (at least a quarter lit)? */
  paintedLit(p: Vec): boolean {
    const f = this.liftFrame;
    if (!this.hasLift || !f) return false;
    const x = Math.floor((p.x - f.origin.x) * f.scale), y = Math.floor((p.y - f.origin.y) * f.scale);
    if (x < 0 || y < 0 || x >= f.w || y >= f.h) return false;
    return this.liftSeen.ctx.getImageData(x, y, 1, 1).data[3] > 63;
  }

  /** Show where light is painted (gold for daylight, blue for dim light) while the DM paints it; hide it otherwise. */
  paintTint(o: { show: boolean; rect: Rect; day: Terrain | null; dim: Terrain | null }) {
    this.tint.visible = o.show;
    if (!o.show) return;
    const scale = Math.min(1, 1400 / Math.max(o.rect.w, o.rect.h, 1));
    const w = Math.max(1, Math.ceil(o.rect.w * scale)), h = Math.max(1, Math.ceil(o.rect.h * scale));
    const origin = { x: o.rect.x, y: o.rect.y };
    const a = this.tintDay.fit(w, h, origin, scale), b = this.tintDim.fit(w, h, origin, scale);
    const key = `${o.day?.sig ?? ''}|${o.dim?.sig ?? ''}|${w}x${h}|${origin.x},${origin.y}`;
    if (!a && !b && key === this.tintKey) return;
    this.tintKey = key;
    const f: Frame = { origin, scale, w, h };
    if (o.day) paintStrokes(this.tintDay.ctx, f, o.day); else this.tintDay.ctx.clearRect(0, 0, w, h);
    if (o.dim) paintStrokes(this.tintDim.ctx, f, o.dim); else this.tintDim.ctx.clearRect(0, 0, w, h);
    this.tintDay.upload();
    this.tintDim.upload();
  }

  destroy() {
    for (const t of [this.shadeT, this.glowT, this.litT, this.seenT]) t.destroy();
    for (const r of this.pool) r.mesh.destroy();
    this.unlit.destroy();
    this.liftShadeTex?.destroy(true);
    this.liftSeenTex?.destroy(true);
    this.tintDay.destroy();
    this.tintDim.destroy();
    this.container.destroy({ children: true });
  }
}
