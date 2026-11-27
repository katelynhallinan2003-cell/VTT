import {cellPoly} from '../core/cells';
import {groundAtTerrain as groundAt, heightColor, surfaceHeight, type Terrain} from '../core/terrain';
import {terrainLabelBoxes} from '../core/terrainLabels';

const MAX_SIDE = 2048;
const SELECT_RGB: [number, number, number] = [0x4d, 0xa3, 0xff];

/** Blur a field with a box of radius `r` (edges repeat), twice, which is close enough to a Gaussian for shading. */
function blur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const run = (from: Float32Array, to: Float32Array, len: number, lines: number, stride: number, step: number) => {
    const n = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * stride;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += from[base + Math.max(0, Math.min(len - 1, k)) * step];
      for (let i = 0; i < len; i++) {
        to[base + i * step] = sum / n;
        sum += from[base + Math.min(len - 1, i + r + 1) * step] - from[base + Math.max(0, i - r) * step];
      }
    }
  };
  let a = src, b = tmp;
  for (let pass = 0; pass < 2; pass++) {
    run(a, b, W, H, W, 1);
    run(b, out, H, W, 1, W);
    a = out; b = tmp;
  }
  return out;
}

export function paintTerrain(t:Terrain,selected:Set<string>,context:(w:number,h:number)=>OffscreenCanvasRenderingContext2D|CanvasRenderingContext2D) {
  const areas=t.areas;
  const grid = t.grid;
  const union = areas.reduce((u, a) => ({ x0: Math.min(u.x0, a.b.x), y0: Math.min(u.y0, a.b.y), x1: Math.max(u.x1, a.b.x + a.b.w), y1: Math.max(u.y1, a.b.y + a.b.h) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  // room around the edge for the shadows that fall outside the high ground
  const pad = Math.max(6, grid.cell * 0.7);
  const bx = union.x0 - pad, by = union.y0 - pad;
  const bw = Math.max(2, union.x1 - union.x0 + pad * 2), bh = Math.max(2, union.y1 - union.y0 + pad * 2);
  const s = Math.min(2, MAX_SIDE / Math.max(bw, bh));
  const W = Math.max(2, Math.ceil(bw * s)), H = Math.max(2, Math.ceil(bh * s));

  const mctx=context(W,H);
  const N = W * H;
  const hgt = new Float32Array(N);
  const cov = new Uint8Array(N);
  const sel = new Uint8Array(N);

  const smooth = new Uint32Array(N);
  for (const a of areas) {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, W, H);
    mctx.setTransform(s, 0, 0, s, -bx * s, -by * s);
    mctx.fillStyle = mctx.strokeStyle = '#fff';
    for (const st of a.strokes) {
      mctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
      if (st.kind === 'polygon') {
        mctx.beginPath();
        for (const ring of st.rings!) {
          mctx.moveTo(ring[0].x, ring[0].y);
          for (const p of ring.slice(1)) mctx.lineTo(p.x,p.y);
          mctx.closePath();
        }
        mctx.fill('evenodd');
      } else if (st.kind === 'rect') mctx.fillRect(st.b.x, st.b.y, st.b.w, st.b.h);
      else if (st.kind === 'ellipse') { mctx.beginPath(); mctx.ellipse(st.b.x + st.b.w / 2, st.b.y + st.b.h / 2, Math.max(0.5, st.b.w / 2), Math.max(0.5, st.b.h / 2), 0, 0, Math.PI * 2); mctx.fill(); }
      else if (st.kind === 'cells') {
        mctx.beginPath();
        for (const c of st.pts) { const poly = cellPoly(grid, c); mctx.moveTo(poly[0].x, poly[0].y); for (let i = 1; i < poly.length; i++) mctx.lineTo(poly[i].x, poly[i].y); mctx.closePath(); }
        mctx.fill();
      } else if (st.pts.length === 1) { mctx.beginPath(); mctx.arc(st.pts[0].x, st.pts[0].y, st.r, 0, Math.PI * 2); mctx.fill(); }
      else {
        mctx.lineWidth = st.r * 2; mctx.lineCap = 'round'; mctx.lineJoin = 'round';
        mctx.beginPath(); mctx.moveTo(st.pts[0].x, st.pts[0].y);
        for (let i = 1; i < st.pts.length; i++) mctx.lineTo(st.pts[i].x, st.pts[i].y);
        mctx.stroke();
      }
    }
    mctx.globalCompositeOperation = 'source-over';
    const x0=Math.max(0,Math.floor((a.b.x-bx)*s)-1), x1=Math.min(W,Math.ceil((a.b.x+a.b.w-bx)*s)+1);
    const y0=Math.max(0,Math.floor((a.b.y-by)*s)-1), y1=Math.min(H,Math.ceil((a.b.y+a.b.h-by)*s)+1);
    if (x1<=x0 || y1<=y0) continue;
    const data = mctx.getImageData(x0,y0,x1-x0,y1-y0).data;
    const isSel = selected.has(a.id);
    // Sample the smooth colour field on a small lattice; the coverage mask keeps the exact outline.
    const stride=8, cols=Math.ceil(W/stride)+1, rows=Math.ceil(H/stride)+1;
    const field=(a.gradient?.length ?? 0)>=2 ? new Float32Array(cols*rows) : null;
    if (field) for (let y=Math.floor(y0/stride);y<=Math.min(rows-1,Math.ceil(y1/stride));y++) for (let x=Math.floor(x0/stride);x<=Math.min(cols-1,Math.ceil(x1/stride));x++) {
      field[y*cols+x]=surfaceHeight(a,{x:bx+(x*stride+0.5)/s,y:by+(y*stride+0.5)/s});
    }
    for (let row=y0,j=3;row<y1;row++) for (let i=row*W+x0;i<row*W+x1;i++,j+=4) {
      if (data[j] < 128) continue;
      if (field) {
        const x=(i%W)/stride,y=Math.floor(i/W)/stride,k=Math.floor(y)*cols+Math.floor(x);
        const fx=x%1,fy=y%1;
        hgt[i]=(field[k]*(1-fx)+field[k+1]*fx)*(1-fy)+(field[k+cols]*(1-fx)+field[k+cols+1]*fx)*fy;
        smooth[i]=a.order+1;
      } else {
        hgt[i] = a.add && cov[i] ? hgt[i] + a.h : a.h;
        if (!a.add) smooth[i]=0;
      }
      cov[i] = 1;
      if (isSel) sel[i] = 1;
    }
  }

  // soft shading: compare each pixel with the ground around it
  const R = Math.max(1, Math.min(MAX_SIDE / 2, Math.round(s * grid.cell / 4)));
  const around = blur(hgt, W, H, R);
  // a faint contour wherever the height changes, softened by a small blur
  const rad = Math.max(1, Math.round(s * Math.max(0.5, grid.cell * 0.01)));
  const edge = new Float32Array(N);
  // Compare the jump across the join with the rise already taking place inside
  // either slope. A continuous rise into the next pixel is not a cliff.
  const contour = (i:number,j:number) => {
    const jump=Math.abs(hgt[i]-hgt[j]);
    if (!jump) return 0;
    if (!smooth[i] && !smooth[j]) return 1;
    if (smooth[i]===smooth[j]) return 0;
    const before=i+(i-j), after=j+(j-i);
    const riseBefore=smooth[i] && smooth[before]===smooth[i] ? Math.abs(hgt[i]-hgt[before]) : 0;
    const riseAfter=smooth[j] && smooth[after]===smooth[j] ? Math.abs(hgt[after]-hgt[j]) : 0;
    return Math.min(1,Math.max(0,jump-Math.max(riseBefore,riseAfter)-0.05));
  };
  for (let y = rad; y < H - rad; y++) {
    for (let x = rad; x < W - rad; x++) {
      const i = y * W + x;
      if (!cov[i]) continue;
      const l = i - rad, r = i + rad, u = i - rad * W, d = i + rad * W;
      if (smooth[i] && smooth[i]===smooth[l] && smooth[i]===smooth[r] && smooth[i]===smooth[u] && smooth[i]===smooth[d]) continue;
      edge[i]=Math.max(contour(i,l),contour(i,r),contour(i,u),contour(i,d));
    }
  }
  const line = blur(edge, W, H, 1);
  const ring = new Float32Array(N); // the outline of the selected areas
  const rs = Math.max(2, Math.round(s * 2.2));
  for (let y = rs; y < H - rs; y++) {
    for (let x = rs; x < W - rs; x++) {
      const i = y * W + x;
      if (sel[i] && (!sel[i - rs] || !sel[i + rs] || !sel[i - rs * W] || !sel[i + rs * W])) ring[i] = 1;
    }
  }

  const out = new ImageData(W, H);
  const px = out.data;
  const lut = new Map<number, [number, number, number]>();
  const heights = new Set<number>();
  for (let i = 0; i < N; i++) if (cov[i]) heights.add(smooth[i] ? Math.round(hgt[i]/5)*5 : hgt[i]);
  const levels = [...heights].sort((a,b) => a-b);
  const colour = (h: number) => {
    const key = Math.round(h * 10) / 10;
    let rgb = lut.get(key);
    if (!rgb) {
      const c = parseInt(heightColor(key,levels).slice(1),16);
      rgb = [(c >> 16) & 255,(c >> 8) & 255,c & 255];
      lut.set(key,rgb);
    }
    return rgb;
  };
  for (let i = 0; i < N; i++) {
    // tint, only on the ground itself
    let a = 0, R_ = 0, G_ = 0, B_ = 0;
    const coverage = cov[i];
    if (coverage) { const c = colour(hgt[i]); R_ = c[0]; G_ = c[1]; B_ = c[2]; a = 0.36 * coverage; }
    // shadow on the low side of a drop, light on the high side
    const d = around[i] - hgt[i];
    const relief = Math.abs(d);
    const k = Math.min(1, relief / 6) ** 0.7 * Math.min(1, relief);
    const sh = d > 0 ? 0.28 * k : 0;
    const hi = d < 0 ? 0.18 * k : 0;
    const over = (cr: number, cg: number, cb: number, ca: number) => {
      if (ca <= 0) return;
      const oa = ca + a * (1 - ca);
      R_ = (cr * ca + R_ * a * (1 - ca)) / oa; G_ = (cg * ca + G_ * a * (1 - ca)) / oa; B_ = (cb * ca + B_ * a * (1 - ca)) / oa;
      a = oa;
    };
    over(10, 12, 20, sh);
    over(255, 255, 255, hi);
    if (cov[i] && line[i] > 0.02) { const c = colour(hgt[i]); over(c[0] * 0.4, c[1] * 0.4, c[2] * 0.4, 0.58 * line[i]); }
    if (ring[i]) over(SELECT_RGB[0], SELECT_RGB[1], SELECT_RGB[2], 1);
    const o = i * 4;
    px[o] = R_; px[o + 1] = G_; px[o + 2] = B_; px[o + 3] = Math.round(Math.min(1, a) * 255);
  }
  // The label finder expects plateaus. Group the gradient into broad elevation bands.
  for (let i=0;i<N;i++) if (smooth[i]) hgt[i]=Math.round(hgt[i]/5)*5;
  const boxes = terrainLabelBoxes(hgt, cov, W, H).map(box => ({
    elevation: box.elevation, x: bx + box.x / s, y: by + box.y / s, w: box.w / s, h: box.h / s,
  })).filter(box => Math.abs(groundAt(t, { x: box.x + box.w / 2, y: box.y + box.h / 2 }) - box.elevation)<2.51);
  return {out,boxes,levels,bx,by,s};
}
export type TerrainRaster=ReturnType<typeof paintTerrain>;
