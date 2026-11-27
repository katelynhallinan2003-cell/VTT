import type { PixelImage } from './gridcut';
import { traceContours } from './walltrace';
import type { Polygon, Pair } from 'polygon-clipping';

export interface HeightMark { x: number; y: number; height: number }
export interface HeightPatch { height: number; polygon: Polygon }
export const UNPAINTED = -32768;

/** Reduce fine texture before comparing the two sides of an edge. All coordinates
 * in the analysis are picture coordinates, independent of the scene grid. */
export function analyzeHeightMap(img: PixelImage, side = 320) {
  const scale = Math.min(1, side / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale)), height = Math.max(1, Math.round(img.height * scale));
  const n = width * height, rgb = new Float32Array(n * 3), opaque = new Uint8Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    let alpha = 0, count = 0;
    for (let yy = Math.floor(y * img.height / height); yy < Math.floor((y + 1) * img.height / height); yy++) {
      for (let xx = Math.floor(x * img.width / width); xx < Math.floor((x + 1) * img.width / width); xx++) {
        const j = (yy * img.width + xx) * 4, a = img.data[j + 3];
        for (let c = 0; c < 3; c++) rgb[i * 3 + c] += img.data[j + c] * a;
        alpha += a;
        count++;
      }
    }
    if (alpha >= 128 * count) {
      opaque[i] = 1;
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] /= alpha;
    }
  }
  const smooth = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (!opaque[i]) continue;
    const x = i % width, y = Math.floor(i / width);
    let sum = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const j = i + dy * width + dx;
      if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height || !opaque[j]) continue;
      const weight = (dx ? 1 : 2) * (dy ? 1 : 2);
      sum += weight;
      for (let c = 0; c < 3; c++) smooth[i * 3 + c] += rgb[j * 3 + c] * weight;
    }
    for (let c = 0; c < 3; c++) smooth[i * 3 + c] /= sum;
  }

  // Store right/down edges once. Group pixels into connected natural patches
  // using each patch's internal contrast, then absorb texture-sized fragments.
  const contrast = new Uint8Array(n * 2), buckets: number[][] = Array.from({length: 256}, () => []);
  for (let i = 0; i < n; i++) if (opaque[i]) {
    for (let dir = 0; dir < 2; dir++) {
      const j = i + (dir ? width : 1);
      if ((!dir && i % width === width - 1) || !opaque[j]) continue;
      const d = Math.round(Math.hypot(smooth[i*3]-smooth[j*3], smooth[i*3+1]-smooth[j*3+1], smooth[i*3+2]-smooth[j*3+2]) / Math.sqrt(3));
      const edge = 2*i+dir;
      contrast[edge] = d;
      buckets[d].push(edge);
    }
  }
  const region = Int32Array.from({length:n}, (_,i) => i), size = new Int32Array(n).fill(1), internal = new Uint8Array(n);
  const root = (i: number) => {
    while (region[i] !== i) { region[i] = region[region[i]]; i = region[i]; }
    return i;
  };
  const minSize = Math.max(4, Math.round(n / 1400));
  for (const cleanup of [false, true]) for (let d = 0; d < buckets.length; d++) for (const edge of buckets[d]) {
    const i = edge >> 1;
    let a = root(i), b = root(i + (edge % 2 ? width : 1));
    if (a === b) continue;
    if (cleanup ? Math.min(size[a],size[b]) >= minSize :
        d > Math.min(internal[a] + 220 / size[a], internal[b] + 220 / size[b])) continue;
    if (size[a] < size[b]) [a,b] = [b,a];
    region[b] = a; size[a] += size[b]; internal[a] = d;
  }
  for (let i = 0; i < n; i++) region[i] = root(i);
  return { width, height, opaque, contrast, region };
}
type Analysis = ReturnType<typeof analyzeHeightMap>;

function neighbors(i: number, w: number, n: number, visit: (j: number, edge: number) => void) {
  if (i % w) visit(i-1, 2*(i-1));
  if (i % w < w-1) visit(i+1, 2*i);
  if (i >= w) visit(i-w, 2*(i-w)+1);
  if (i+w < n) visit(i+w, 2*i+1);
}

/** Simultaneous edge-weighted floods. Every assigned pixel has a connected
 * route back to its mark. Tracks, grid lines and isolated flecks cannot become
 * separate heights without a mark. Integer distances use a circular bucket queue. */
export function draftHeights(map: Analysis, marks: HeightMark[]) {
  const {width:w, opaque, region, contrast} = map, n = opaque.length;
  const extend = marks.some(a => a.height !== marks[0].height);
  const labels = new Int16Array(n).fill(UNPAINTED), dist = new Uint32Array(n).fill(0xffffffff);
  const maxStep = 4096, queues: number[][] = Array.from({length:maxStep+1}, () => []);
  let pending = 0;
  for (const mark of marks) {
    const i = mark.y*w + mark.x;
    if (!opaque[i]) continue;
    labels[i] = mark.height;
    if (dist[i] === 0) continue;
    dist[i] = 0; queues[0].push(i); pending++;
  }
  for (let cost = 0; pending; cost++) {
    const queue = queues[cost % queues.length];
    while (queue.length) {
      const i = queue.pop()!;
      pending--;
      if (cost !== dist[i]) continue;
      neighbors(i,w,n,(j,edge) => {
        if (!opaque[j] || (!extend && region[i] !== region[j])) return;
        const d = contrast[edge];
        const next = cost + Math.min(maxStep, 2 + d*d + (region[i] !== region[j] ? 80 : 0));
        if (next >= dist[j]) return;
        dist[j] = next; labels[j] = labels[i];
        queues[next % queues.length].push(j); pending++;
      });
    }
  }

  // Close enclosed pockets with the surrounding height. Every other unclaimed
  // location, including map margins, becomes explicit, editable base terrain.
  if (marks.length) {
    const seen = new Uint8Array(n), queue = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      if (seen[i] || labels[i] !== UNPAINTED) continue;
      let end = 1, rim = UNPAINTED, open = false;
      queue[0] = i; seen[i] = 1;
      for (let k = 0; k < end; k++) {
        const p = queue[k];
        if (p < w || p >= n-w || p%w === 0 || p%w === w-1) open = true;
        neighbors(p,w,n,j => {
          if (labels[j] !== UNPAINTED) {
            if (rim !== UNPAINTED && rim !== labels[j]) open = true;
            rim = labels[j];
          } else if (!seen[j]) { seen[j] = 1; queue[end++] = j; }
        });
      }
      const height = !open && rim !== UNPAINTED ? rim : 0;
      for (let k = 0; k < end; k++) labels[queue[k]] = height;
    }
  }
  return labels;
}

/** Trace each connected component separately. Padding closes shapes at the map
 * edge. Keeping shared corners exact prevents cracks between saved polygons. */
export function heightPolygons(labels: Int16Array, w: number): HeightPatch[] {
  const n = labels.length, seen = new Uint8Array(n), queue = new Int32Array(n), patches: HeightPatch[] = [];
  for (let i = 0; i < n; i++) {
    const height = labels[i];
    if (seen[i] || height === UNPAINTED) continue;
    let end = 1, left = w, top = n, right = 0, bottom = 0;
    seen[i] = 1; queue[0] = i;
    for (let k = 0; k < end; k++) {
      const p = queue[k], x = p % w, y = Math.floor(p / w);
      left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y);
      neighbors(p,w,n,j => { if (!seen[j] && labels[j] === height) { seen[j] = 1; queue[end++] = j; } });
    }
    const mw = right-left+3, mh = bottom-top+3, mask = new Uint8Array(mw*mh);
    for (let k = 0; k < end; k++) {
      const p = queue[k];
      mask[(Math.floor(p/w)-top+1)*mw + p%w-left+1] = 1;
    }
    const polygon: Polygon = [];
    for (const loop of traceContours(mask,mw,mh)) {
      loop.pop();
      const ring: Pair[] = [];
      let area = 0;
      for (let k = 0; k < loop.length; k++) {
        const p = loop[k], prev = loop[(k+loop.length-1)%loop.length], next = loop[(k+1)%loop.length];
        area += p.x*next.y-next.x*p.y;
        if (prev.x === next.x || prev.y === next.y) continue;
        const x = left+p.x-1, y = top+p.y-1;
        // Bevel the same corner on both sides. Keep map edges and junctions fixed.
        const v = y*w+x;
        const around = [labels[v-w-1],labels[v-w],labels[v-1],labels[v]];
        const count = around.filter(a => a === height).length;
        if (x>0 && x<w && y>0 && v<n && count!==2 && new Set(around).size===2) {
          const incoming: Pair = [x+(prev.x-p.x)/2,y+(prev.y-p.y)/2];
          if (!ring.length || incoming[0]!==ring[ring.length-1][0] || incoming[1]!==ring[ring.length-1][1]) ring.push(incoming);
          ring.push([x+(next.x-p.x)/2,y+(next.y-p.y)/2]);
        } else ring.push([x,y]);
      }
      if (ring[0][0] === ring[ring.length-1][0] && ring[0][1] === ring[ring.length-1][1]) ring.pop();
      const corners = ring.filter(([x,y],k) => {
        const a = ring[(k+ring.length-1)%ring.length], b = ring[(k+1)%ring.length];
        return (x-a[0])*(b[1]-y) !== (y-a[1])*(b[0]-x);
      });
      if (area > 0) polygon.unshift(corners); else polygon.push(corners);
    }
    patches.push({height, polygon});
  }
  return patches;
}
