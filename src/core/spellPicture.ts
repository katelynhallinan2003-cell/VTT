import { spellSurface, type SurfaceImage } from './spellSurface';
import { cellPoly } from './cells';
import type { GridSettings, Vec } from '../types';
import { isHex } from './hex';
import { mapSegments, spellVolume, type Spell, type SpellWorld } from './spellVolume';
export type Volume = ReturnType<typeof spellVolume>;
export interface SpellPicture {
  surface: SurfaceImage;
  /** Rectangles as left, top, right, bottom or hex centers as x, y. */
  fill: Float32Array;
  /** Boundary triangles on gridless maps. Interior rows use fill rectangles. */
  triangles: Float32Array;
  composed?: boolean;
  hex: boolean;
  solid: boolean;
  outline: Float32Array;
  wire: Float32Array;
  contact: Float32Array;
}
/** A covered cell behind a line's emitting face is cut at the origin. */
export function trimSpellCell(poly:Vec[],origin:Vec,axis:{ux:number;uy:number}):Vec[] {
  const forward=(p:Vec)=>(p.x-origin.x)*axis.ux+(p.y-origin.y)*axis.uy;
  const out:Vec[]=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],dp=forward(p),dq=forward(q);
    if(dp>=0)out.push(p);
    if((dp<0)!==(dq<0))out.push(lerp(p,q,dp/(dp-dq)));
  }
  return out;
}
export function spellOutline(v: Volume): Vec[] {
  const g = v.geom;
  if (g.type === 'poly') return g.pts;
  return Array.from({
    length: 96
  }, (_, i) => ({
    x: g.c.x + g.r * Math.cos(i * Math.PI / 48),
    y: g.c.y + g.r * Math.sin(i * Math.PI / 48)
  }));
}
const lerp = (a: Vec, b: Vec, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t
});
const add = (out: number[], a: Vec, b: Vec) => {
  out.push(a.x, a.y, b.x, b.y);
};

/** Sample a projected volume at the actual surface. Outline, interior wires and the
 * surface cut are distinct: the top of a solid can clear ground while a lower wire is buried. */
export function floorLines(v: Volume, grid: GridSettings, world: SpellWorld, elevated: boolean, fast = false) {
  const ground = world.ground ?? (() => 0),
    maps = world.maps ?? [];
  const outline: number[] = [],
    wire: number[] = [];
  const tol = 1e-5,
    step = Math.max(grid.cell / (fast ? 3 : 8), Math.max(v.bounds.w, v.bounds.h) / (fast ? 44 : 96), .01);
  function line(out: number[], a: Vec, b: Vec, height: (p: Vec, t: number) => number) {
    for (const [l, r] of mapSegments(a, b, maps)) {
      if (!elevated) {
        add(out, l, r);
        continue;
      }
      const dx = b.x - a.x,
        dy = b.y - a.y,
        den = dx * dx + dy * dy;
      if (!den) continue;
      const above = (p: Vec) => height(p, ((p.x - a.x) * dx + (p.y - a.y) * dy) / den) >= ground(p) - tol;
      const n = Math.max(1, Math.ceil(Math.hypot(r.x - l.x, r.y - l.y) / step));
      let prev = l,
        show = above(l),
        begin = l;
      for (let i = 1; i <= n; i++) {
        const q = lerp(l, r, i / n),
          visible = above(q);
        if (visible !== show) {
          let low = prev,
            high = q;
          for (let k = 0; k < 9; k++) {
            const mid = lerp(low, high, .5);
            if (above(mid) === show) low = mid;else high = mid;
          }
          const cut = lerp(low, high, .5);
          if (show) add(out, begin, cut);else begin = cut;
        }
        prev = q;
        show = visible;
      }
      if (show) add(out, begin, r);
    }
  }
  const ring = spellOutline(v);
  for (let i = 0; i < ring.length; i++) line(outline, ring[i], ring[(i + 1) % ring.length], p => v.heightSpan(p)?.[1] ?? v.axis.start);
  for (const path of v.edges) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    line(wire, a, b, (_, t) => a.height + (b.height - a.height) * t);
  }

  return {
    outline: new Float32Array(outline),
    wire: new Float32Array(wire)
  };
}
export interface PictureRequest {
  color: string;
  spell: Spell;
  a: Vec;
  b: Vec;
  cover: boolean;
  fast: boolean;
}
export function spellPicture(req: PictureRequest, grid: GridSettings, world: SpellWorld): SpellPicture {
  const {
      spell,
      a,
      b,
      cover,
      fast
    } = req,
    v = spellVolume(spell, a, b, grid, world);
  const lines = floorLines(v, grid, world, spell.spell?.elevation !== false, fast);
  const solid = !cover && !v.hasWalls && !v.groundClips;
  const data:number[]=[], triangles:number[]=[], contact:number[]=[];
  const hex=cover && isHex(grid);
  if (cover) {
    const cells=v.cells(grid,true);
    const edges=new Map<string,[Vec,Vec]>();
    const key=(p:Vec)=>Math.round(p.x*10000)+','+Math.round(p.y*10000);
    for (const p of cells) {
      const cell=cellPoly(grid,p);
      const ring=spell.k==='beam' ? trimSpellCell(cell,a,v.axis) : cell;
      for(let i=0;i<ring.length;i++) {
        const a=ring[i], b=ring[(i+1)%ring.length], ka=key(a),kb=key(b);
        const id=ka<kb ? ka+';'+kb : kb+';'+ka;
        if(!edges.delete(id)) edges.set(id,[a,b]);
      }
      if(hex) data.push(p.x,p.y);
    }
    if(!hex) {
      cells.sort((a,b)=>a.y-b.y || a.x-b.x);
      const h=grid.cell/2;
      for(let i=0;i<cells.length;){
        const p=cells[i++];let right=p.x+h;
        while(i<cells.length && cells[i].y===p.y && cells[i].x-h<=right+1e-6)right=cells[i++].x+h;
        data.push(p.x-h,p.y-h,right,p.y+h);
      }
    }
    for(const [a,b] of edges.values()) for(const [l,r] of mapSegments(a,b,world.maps ?? [])) add(contact,l,r);
  } else if(solid) {
    const ring=spellOutline(v);
    for(let i=0;i<ring.length;i++) for(const [a,b] of mapSegments(ring[i],ring[(i+1)%ring.length],world.maps ?? [])) add(contact,a,b);
  } else if (v.bounds.w>0 && v.bounds.h>0) {
    // Use the same floor-height hit query for both the coloured region and
    // its outline. Refine mixed cells on their edges; uniform rows are cheap.
    const size=Math.max(grid.cell/(fast ? 3 : 9),Math.max(v.bounds.w,v.bounds.h)/(fast ? 40 : 128));
    const x0=Math.floor(v.bounds.x/size)*size-size,y0=Math.floor(v.bounds.y/size)*size-size;
    const cols=Math.ceil((v.bounds.x+v.bounds.w-x0)/size)+1, rows=Math.ceil((v.bounds.y+v.bounds.h-y0)/size)+1;
    const hit=(p:Vec)=>v.hits(p,world.ground?.(p) ?? 0);
    type Corner=Vec & {inside:boolean};
    const corner=(x:number,y:number):Corner=>({x,y,inside:hit({x,y})});
    const row=(y:number)=>Array.from({length:cols+1},(_,i)=>corner(x0+i*size,y));
    const crossings=new WeakMap<Corner,WeakMap<Corner,Vec>>();
    function boundary(a:Corner,b:Corner):Vec {
      if (!a.inside) [a,b]=[b,a];
      let edges=crossings.get(a);
      if(!edges)crossings.set(a,edges=new WeakMap());
      const cached=edges.get(b);
      if(cached)return cached;
      let l:Vec=a,r:Vec=b;
      for(let n=0;n<(fast ? 2 : 5);n++){
        const m=lerp(l,r,.5);
        if(hit(m)===a.inside) l=m; else r=m;
      }
      const crossing=lerp(l,r,.5);
      edges.set(b,crossing);
      return crossing;
    }
    function clippedTriangle(ps:Corner[]) {
      const poly:Vec[]=[], cut:Vec[]=[];
      for(let k=0;k<3;k++){
        const a=ps[k],b=ps[(k+1)%3];
        if(a.inside) poly.push(a);
        if(a.inside!==b.inside){ const p=boundary(a,b);poly.push(p);cut.push(p); }
      }
      for(let k=2;k<poly.length;k++) triangles.push(poly[0].x,poly[0].y,poly[k-1].x,poly[k-1].y,poly[k].x,poly[k].y);
      if(cut.length===2) add(contact,cut[0],cut[1]);
    }
    let top=row(y0);
    for(let j=0;j<rows;j++){
      const y=y0+j*size,bottom=row(y0+(j+1)*size);
      let full=-1;
      for(let i=0;i<=cols;i++){
        const ps=i<cols ? [top[i],top[i+1],bottom[i+1],bottom[i]] : [];
        if(ps.length && ps.every(p=>p.inside)){ if(full<0)full=i; continue; }
        if(full>=0){data.push(x0+full*size,y,x0+i*size,y+size);full=-1;}
        if(!ps.length || !ps.some(p=>p.inside)) continue;
        const m=corner(x0+(i+.5)*size,y+size/2);
        for(let k=0;k<4;k++)clippedTriangle([ps[k],ps[(k+1)%4],m]);
      }
      top=bottom;
    }
  }
  // The translucent shell shows the solid above the terrain. A shadow on
  // the floor does not cut a column through the sphere overhead.
  const surface = spellSurface(spell, a, v, grid, world, req.color, fast);
  return {...lines,contact:new Float32Array(contact),surface,solid,hex,fill:new Float32Array(data),triangles:new Float32Array(triangles)};
}
