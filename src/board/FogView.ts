import { Container, Filter, GlProgram, Mesh, MeshGeometry, RenderTexture, Shader, Sprite, Texture, type Renderer } from 'pixi.js';
import type { Rect, Vec } from '../types';
import { GREY_FOG } from '../core/fog';
import { canvasTexture } from './textures';

// The fog is drawn on the GPU. The scene's fog (hidden, revealed and explored
// ground) is a bounded canvas that only changes when the fog is edited. What
// the tokens see now is rendered as triangles into a separate bounded texture
// around the viewers, feathered by an exact Gaussian, and cut out of the fog in
// one shader pass. Nothing here ever allocates a texture the size of the
// zoomed map, and moving a token uploads no pixels.

/** The largest side of the texture that holds the current sight. */
const SIGHT_MAX = 2048;

const quadVertex = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
out vec2 vWorld;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
  vWorld = aPosition;
}`;

const liveSight = `
uniform sampler2D uSight;
uniform vec4 uSightMap;
uniform vec4 uSightClamp;
uniform float uSightOn;
float sightAt(vec2 world) {
  vec2 s = (world - uSightMap.xy) * uSightMap.zw;
  if (uSightOn < 0.5 || any(lessThan(s, uSightClamp.xy)) || any(greaterThan(s, uSightClamp.zw))) return 0.0;
  return texture(uSight, s).a;
}`;

const fogFragment = `
precision highp float;
in vec2 vUV;
in vec2 vWorld;
out vec4 finalColor;
uniform sampler2D uFog;
uniform float uAlpha;
${liveSight}
void main() {
  float fog = texture(uFog, vUV).a;
  float a = fog * (1.0 - sightAt(vWorld)) * uAlpha;
  float memory = 1.0 - smoothstep(${GREY_FOG}, 1.0, fog);
  finalColor = vec4(vec3(0.24, 0.26, 0.28) * memory * a, a);
}`;

// The same fog and live-sight textures clip moving things pixel by pixel.
// A spell spanning a doorway can show its near half while its far half stays hidden.
const actorFragment = `
precision highp float;
in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uFog;
uniform vec4 uFogMap;
uniform vec4 uCamera;
${liveSight}
void main() {
  vec2 world = (vScreen - uCamera.xy) * uCamera.z;
  vec2 uv = (world - uFogMap.xy) * uFogMap.zw;
  float visibility = 1.0;
  if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
    float covered = smoothstep(0.0, ${GREY_FOG}, texture(uFog, uv).a);
    visibility = mix(1.0, smoothstep(0.10, 0.45, sightAt(world)), covered);
  }
  finalColor = texture(uTexture, vTextureCoord) * visibility;
}`;

// One direction of a separable Gaussian. Pairs of taps share one bilinear
// fetch, so a nine-pixel feather costs about fourteen fetches a side.
const blurFragment = `
precision highp float;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uInputClamp;
uniform vec2 uDir;
uniform float uSigma;
uniform float uGain;
vec4 tap(vec2 p) { return texture(uTexture, clamp(p, uInputClamp.xy, uInputClamp.zw)); }
void main() {
  vec4 sum = tap(vTextureCoord);
  if (uSigma >= 0.2) {
    vec2 unit = uDir * uInputSize.zw;
    float k = 1.0 / (2.0 * uSigma * uSigma);
    float total = 1.0;
    float reach = ceil(uSigma * 3.0);
    for (int i = 1; i < 128; i += 2) {
      float a = float(i);
      if (a > reach) break;
      float w1 = exp(-a * a * k), w2 = exp(-(a + 1.0) * (a + 1.0) * k);
      float w = w1 + w2;
      vec2 off = unit * ((a * w1 + (a + 1.0) * w2) / w);
      sum += w * (tap(vTextureCoord + off) + tap(vTextureCoord - off));
      total += 2.0 * w;
    }
    sum /= total;
  }
  finalColor = sum * uGain;
}`;

const filterVertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  vScreen = position;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

class GaussPass extends Filter {
  constructor(horizontal: boolean) {
    super({
      glProgram: GlProgram.from({ vertex: filterVertex, fragment: blurFragment, name: 'fog-gauss' }),
      resources: { gaussUniforms: {
        uDir: { value: new Float32Array(horizontal ? [1, 0] : [0, 1]), type: 'vec2<f32>' },
        uSigma: { value: 0, type: 'f32' },
        uGain: { value: 1, type: 'f32' },
      } },
      resolution: 1,
      antialias: 'off',
    });
  }
  set(sigma: number, gain: number) {
    const u = this.resources.gaussUniforms.uniforms;
    u.uSigma = sigma;
    u.uGain = gain;
    this.padding = Math.ceil(sigma * 3) + 2;
  }
}

/** One feather: a horizontal and a vertical pass; the second scales the result. */
class Feather {
  readonly h = new GaussPass(true);
  readonly v = new GaussPass(false);
  readonly list: Filter[] = [this.h, this.v];
  set(sigma: number, gain: number) { this.h.set(sigma, 1); this.v.set(sigma, gain); }
}

/** Triangles in map coordinates: three x,y pairs each. */
export type SightFill = Float32Array;

export class FogView {
  /** the fog as drawn on the board */
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private fogTex: Texture = Texture.EMPTY;
  private fogCanvas: HTMLCanvasElement | null = null;
  private fogSize = '';
  private rect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private shader: Shader;
  readonly actorFilter: Filter;
  private sightRT: RenderTexture | null = null;
  private stage = new Container();
  private shape = new Mesh({ geometry: new MeshGeometry({ positions: new Float32Array(6), uvs: new Float32Array(6), indices: new Uint32Array([0, 1, 2]) }), texture: Texture.WHITE });
  private picture = new Sprite(Texture.EMPTY);
  private wide = new Feather();
  private narrow = new Feather();
  private capacity = 0;
  /** where the sight texture sits on the map: origin and texture pixels per map pixel */
  frame: { x: number; y: number; scale: number; w: number; h: number } | null = null;

  constructor(private renderer: () => Renderer) {
    const geometry = new MeshGeometry({ positions: new Float32Array(8), uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]) });
    this.shader = new Shader({
      glProgram: GlProgram.from({ vertex: quadVertex, fragment: fogFragment, name: 'fog-view' }),
      resources: {
        uFog: Texture.EMPTY.source,
        uSight: Texture.EMPTY.source,
        fogUniforms: {
          uCamera: { value: new Float32Array(4), type: 'vec4<f32>' },
          uFogMap: { value: new Float32Array(4), type: 'vec4<f32>' },
          uSightMap: { value: new Float32Array(4), type: 'vec4<f32>' },
          uSightClamp: { value: new Float32Array(4), type: 'vec4<f32>' },
          uSightOn: { value: 0, type: 'f32' },
          uAlpha: { value: 1, type: 'f32' },
        },
      },
    });
    this.actorFilter = new Filter({
      glProgram: GlProgram.from({ vertex: filterVertex, fragment: actorFragment, name: 'fog-live-objects' }),
      resources: { uFog: Texture.EMPTY.source, uSight: Texture.EMPTY.source, fogUniforms: this.shader.resources.fogUniforms },
      resolution: 'inherit',
    });
    this.mesh = new Mesh({ geometry, shader: this.shader });
    this.stage.addChild(this.shape, this.picture);
  }

  private get uniforms() { return this.shader.resources.fogUniforms.uniforms; }

  /** The fog's own picture (black where it is fogged), covering `rect` on the map. Call `fogChanged` when its pixels change. */
  setFog(canvas: HTMLCanvasElement, rect: Rect) {
    this.uniforms.uFogMap.set([rect.x, rect.y, 1 / rect.w, 1 / rect.h]);
    const size = `${canvas.width}x${canvas.height}`;
    if (canvas !== this.fogCanvas || size !== this.fogSize || this.fogTex === Texture.EMPTY) {
      const old = this.fogTex;
      this.fogTex = canvasTexture(canvas);
      this.fogCanvas = canvas;
      this.fogSize = size;
      this.actorFilter.resources.uFog = this.shader.resources.uFog = this.fogTex.source;
      if (old !== Texture.EMPTY) old.destroy(true);
    }
    if (rect.x !== this.rect.x || rect.y !== this.rect.y || rect.w !== this.rect.w || rect.h !== this.rect.h) {
      this.rect = { ...rect };
      const { x, y, w, h } = rect;
      this.mesh.geometry.positions = new Float32Array([x, y, x + w, y, x + w, y + h, x, y + h]);
    }
  }

  setCamera(tx: number, ty: number, zoom: number) {
    const camera = this.uniforms.uCamera;
    camera[0] = tx; camera[1] = ty; camera[2] = 1 / zoom;
  }

  fogChanged() { if (this.fogTex !== Texture.EMPTY) this.fogTex.source.update(); }

  set alpha(a: number) { this.uniforms.uAlpha = a; }

  /** Nothing can be seen right now: the fog is whole. */
  clearSight() {
    this.uniforms.uSightOn = 0;
    this.frame = null;
  }

  private target(w: number, h: number): RenderTexture {
    const need = Math.max(256, 2 ** Math.ceil(Math.log2(Math.max(w, h))));
    if (!this.sightRT || need > this.capacity) {
      const old = this.sightRT;
      this.capacity = Math.min(SIGHT_MAX, need);
      this.sightRT = RenderTexture.create({ width: this.capacity, height: this.capacity, antialias: false });
      this.actorFilter.resources.uSight = this.shader.resources.uSight = this.sightRT.source;
      old?.destroy(true);
    }
    return this.sightRT;
  }

  private place(bounds: Rect, pad: number, maxScale: number) {
    const span = Math.max(bounds.w, bounds.h) + 2 * pad;
    const scale = Math.min(maxScale, SIGHT_MAX / Math.max(1, span));
    // Snap the frame to its own pixel grid so a moving viewer never shimmers.
    const x = Math.floor((bounds.x - pad) * scale) / scale, y = Math.floor((bounds.y - pad) * scale) / scale;
    const w = Math.min(SIGHT_MAX, Math.ceil((bounds.x + bounds.w + pad - x) * scale) + 1);
    const h = Math.min(SIGHT_MAX, Math.ceil((bounds.y + bounds.h + pad - y) * scale) + 1);
    return { x, y, scale, w, h };
  }

  private finish(f: { x: number; y: number; scale: number; w: number; h: number }) {
    const size = this.capacity;
    const u = this.uniforms;
    u.uSightMap[0] = f.x; u.uSightMap[1] = f.y; u.uSightMap[2] = f.scale / size; u.uSightMap[3] = f.scale / size;
    u.uSightClamp[0] = 0; u.uSightClamp[1] = 0; u.uSightClamp[2] = (f.w - .5) / size; u.uSightClamp[3] = (f.h - .5) / size;
    u.uSightOn = 1;
    this.frame = f;
  }

  /**
   * Cut what the viewers see out of the fog. `fill` is the union of their
   * sight as triangles in map coordinates; `feather` is the soft edge's width
   * in map pixels. A broad faint fringe and a narrow full one.
   */
  drawSight(fill: SightFill, bounds: Rect, feather: number, maxScale = 1) {
    const f = this.place(bounds, feather * 3 + 4, maxScale);
    const rt = this.target(f.w, f.h);
    const geometry = this.shape.geometry;
    const count = fill.length / 2;
    geometry.positions = fill;
    if (geometry.uvs.length !== fill.length) geometry.uvs = new Float32Array(fill.length);
    if (geometry.indices.length !== count) {
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i++) idx[i] = i;
      geometry.indices = idx;
    }
    this.shape.visible = true;
    this.picture.visible = false;
    this.shape.position.set(-f.x * f.scale, -f.y * f.scale);
    this.shape.scale.set(f.scale);
    const sigma = feather * f.scale;
    this.wide.set(sigma, .45);
    this.narrow.set(Math.max(.65, sigma * .28), 1);
    const r = this.renderer();
    this.stage.filters = this.wide.list;
    r.render({ container: this.stage, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    this.stage.filters = this.narrow.list;
    this.narrow.v.blendMode = 'normal';
    r.render({ container: this.stage, target: rt, clear: false });
    this.stage.filters = null;
    this.finish(f);
  }

  /**
   * In the dark the visible ground is a texture of light levels drawn by the light layer (`tex`, covering frame `f`).
   * Its two feathers add up, so an evenly dim patch keeps its level. `feather` is in map pixels.
   */
  drawSightTexture(tex: Texture, f: { x: number; y: number; scale: number; w: number; h: number }, feather: number) {
    const rt = this.target(f.w, f.h);
    this.shape.visible = false;
    this.picture.visible = true;
    this.picture.texture = tex;
    this.picture.position.set(0, 0);
    this.picture.scale.set(1);
    const sigma = feather * f.scale;
    this.wide.set(sigma, .3);
    this.narrow.set(Math.max(.65, sigma * .28), .7);
    const r = this.renderer();
    this.stage.filters = this.wide.list;
    r.render({ container: this.stage, target: rt, clear: true, clearColor: [0, 0, 0, 0] });
    this.stage.filters = this.narrow.list;
    this.narrow.v.blendMode = 'add';
    r.render({ container: this.stage, target: rt, clear: false });
    this.narrow.v.blendMode = 'normal';
    this.stage.filters = null;
    this.finish(f);
  }

  destroy() {
    this.actorFilter.destroy();
    this.mesh.destroy();
    this.shape.destroy();
    this.picture.destroy();
    this.sightRT?.destroy(true);
    if (this.fogTex !== Texture.EMPTY) this.fogTex.destroy(true);
  }
}
