import type { Drawing, GridSettings, Rect, Vec } from '../types';
import { boundsOf, distToSegment, footprintPoly, pointInPoly, templateGeom, templateWidthPx } from './draw';
import { rayHit, sideOf, type Seg } from './walls';
import { cellCentersIn, MAX_COVERED } from './cells';
import { rectContains } from './geometry';

export type Spell = Pick<Drawing,'k'|'bw'|'of'|'spell'>;
export interface SpellWorld { segs:Seg[]; ground?:(p:Vec)=>number; maps?:Rect[] }
export const aimedSpell=(k:Drawing['k'])=>k==='cone' || k==='beam' || k==='cube';
const distance=(a:Vec,b:Vec)=>Math.hypot(b.x-a.x,b.y-a.y);
const clamp=(v:number,l:number,h:number)=>Math.max(l,Math.min(h,v));
export function onMap(p:Vec,maps:Rect[]=[]) { return !maps.length || maps.some(r=>rectContains(r,p)); }
export function mapPoint(p:Vec,maps:Rect[]) {
  if (onMap(p,maps)) return p;
  let best=p, dist=Infinity;
  for (const r of maps) {
    const near={x:clamp(p.x,r.x,r.x+r.w),y:clamp(p.y,r.y,r.y+r.h)}, d=distance(p,near);
    if(d<dist) { best=near;dist=d; }
  }
  return best;
}

function hull(points:Vec[]) {
  const sorted=points.slice().sort((a,b)=>a.x-b.x || a.y-b.y);
  function half(ps:Vec[]) {
    const out:Vec[]=[];
    for(const p of ps) {
      while(out.length>=2) {
        const a=out[out.length-2],b=out[out.length-1];
        if ((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)>0) break;
        out.pop();
      }
      out.push(p);
    }
    return out.slice(0,-1);
  }
  return [...half(sorted),...half(sorted.reverse())];
}

export function spellAxis(d:Spell,a:Vec,target:Vec,grid:GridSettings,ground:(p:Vec)=>number=()=>0) {
  const px=grid.cell/grid.ft, settings=d.spell ?? {};
  const elevated=settings.elevation!==false, aimed=aimedSpell(d.k);
  const start=elevated ? settings.start ?? ground(a) : 0;
  const endAt=(p:Vec)=>aimed && elevated ? settings.end ?? ground(p) : start;
  const raw=distance(a,target), ux=raw ? (target.x-a.x)/raw : 1, uy=raw ? (target.y-a.y)/raw : 0;
  const at=(r:number)=>({x:a.x+ux*r,y:a.y+uy*r});
  const offset=d.k==='emanation' ? templateWidthPx(grid,d)/2 : 0;
  let end=endAt(target),run=raw;
  const feet=settings.range ?? Math.max(0,Math.hypot(raw,(end-start)*px)-offset)/px;
  if(settings.range!==undefined) {
    const range=feet*px;
    const project=(height:number)=>Math.sqrt(Math.max(0,range*range-((height-start)*px)**2));
    run=project(end)+offset;
    if(aimed && elevated && settings.end===undefined && Math.abs(endAt(at(run))-end)>1e-6) {
      // Intersect the range sphere with the ground along the cast bearing.
      // A jump in ground height intersects the vertical face of that cliff.
      let lo=0,hi=range;
      for(let i=0;i<32;i++) {
        const mid=(lo+hi)/2;
        if(Math.hypot(mid,(endAt(at(mid))-start)*px)<=range) lo=mid; else hi=mid;
      }
      run=(lo+hi)/2;
      const sign=Math.sign(endAt(at(hi))-start);
      end=start+sign*Math.sqrt(Math.max(0,range*range-run*run))/px;
    } else end=start+clamp(end-start,-feet,feet);
  }
  return {b:at(run),start,end,run,ux,uy,feet};
}

export function snapSpellFeet(feet:number,gridded:boolean) {
  return gridded ? Math.max(5,Math.round(feet/5)*5) : feet;
}

/** All distances inside the volume calculation use the same unit, including Z. */
export function spellVolume(d:Spell, a:Vec,b:Vec,grid:GridSettings,world:SpellWorld={segs:[]}) {
  const px=grid.cell/grid.ft, settings=d.spell ?? {}, ground=world.ground ?? (()=>0);
  const elevated=settings.elevation!==false, aimed=aimedSpell(d.k);
  const axis=spellAxis(d,a,b,grid,ground);
  const {start,end,run,ux,uy}=axis;
  b=axis.b;
  const rise=(end-start)*px, length=Math.hypot(run,rise);
  const cos=length ? run/length : 1, sin=length ? rise/length : 0;
  const width=templateWidthPx(grid,d), half=(d.k==='cube' ? length : width)/2;
  const hex=grid.shape==='square' ? undefined : grid.shape;
  const own=d.k==='emanation' ? footprintPoly(a,width,hex) : undefined;
  const radius=own ? Math.max(0,run-width/2) : run;
  let geom=templateGeom(d.k,a,b,width,hex);
  if (aimed && rise) {
    const project=(at:Vec,side:number,up:number)=>({x:at.x-uy*side-ux*sin*up,y:at.y+ux*side-uy*sin*up});
    const verts=d.k==='cone' ? [a,...Array.from({length:64},(_,i)=>project(b,
      Math.cos(i*Math.PI/32)*length/2,Math.sin(i*Math.PI/32)*length/2))] :
      [a,b].flatMap(p=>[-half,half].flatMap(y=>[-half,half].map(z=>project(p,y,z))));
    geom={type:'poly',pts:hull(verts)};
  }
  const bounds=geom.type==='circle' ? {x:a.x-run,y:a.y-run,w:2*run,h:2*run} : boundsOf(geom.pts);
  const eps=grid.cell*.00001;
  // Intersect the vertical column at p with the oriented solid. Return Z in
  // world pixels relative to the origin. Cones have a circular cross section.
  function slice(p:Vec):[number,number]|null {
    const dx=p.x-a.x,dy=p.y-a.y,x=dx*ux+dy*uy,y=dy*ux-dx*uy;
    if(!aimed) {
      if(own && pointInPoly(p,own)) return null;
      const lateral=own ? Math.min(...own.map((q,i)=>distToSegment(p,q,own[(i+1)%own.length]))) : Math.hypot(dx,dy);
      if(lateral>radius+eps) return null;
      const h=Math.sqrt(Math.max(0,radius*radius-lateral*lateral));
      return [-h,h];
    }
    let lo=-length-half-Math.abs(rise)-1,hi=-lo;
    const band=(offset:number,slope:number,min:number,max:number)=>{
      if(Math.abs(slope)<1e-10) return offset>=min-eps && offset<=max+eps;
      const z1=(min-offset)/slope,z2=(max-offset)/slope;
      lo=Math.max(lo,Math.min(z1,z2)); hi=Math.min(hi,Math.max(z1,z2));
      return lo<=hi+eps;
    };
    if(!band(cos*x,sin,0,length)) return null;
    if(d.k!=='cone') return Math.abs(y)<=half+eps && band(-sin*x,cos,-half,half) ? [lo,hi] : null;
    // (cos*z - sin*x)^2 + side^2 <= (cos*x + sin*z)^2 / 4.
    const A=cos*cos-sin*sin/4,B=-2.5*cos*sin*x,C=(sin*sin-cos*cos/4)*x*x+y*y;
    const cuts=[lo,hi],disc=B*B-4*A*C;
    if(Math.abs(A)<1e-10) { if(Math.abs(B)>1e-10) cuts.push(-C/B); }
    else if(disc>=0) { cuts.push((-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A)); }
    const ordered=cuts.filter(z=>z>=lo && z<=hi).sort((l,r)=>l-r);
    let bottom=Infinity,top=-Infinity;
    const inside=(z:number)=>(A*z+B)*z+C<=eps*eps;
    for(let i=0;i<ordered.length;i++) {
      const z=ordered[i],next=ordered[i+1] ?? z;
      if(inside(z)) { bottom=Math.min(bottom,z);top=Math.max(top,z); }
      if(inside((next+z)/2)) { bottom=Math.min(bottom,z);top=Math.max(top,next); }
    }
    return top>=bottom ? [bottom,top] : null;
  }
  const walls=settings.walls===false ? [] : world.segs.filter(s=>Math.min(s.a.x,s.b.x)<=bounds.x+bounds.w+eps &&
    Math.max(s.a.x,s.b.x)>=bounds.x-eps && Math.min(s.a.y,s.b.y)<=bounds.y+bounds.h+eps && Math.max(s.a.y,s.b.y)>=bounds.y-eps);
  const blocker=(from:Vec,z0:number,to:Vec,z1:number)=>{
    for(const wall of walls) {
      if(wall.one && sideOf(wall,from)===-wall.one) continue;
      const t=rayHit(from,to.x-from.x,to.y-from.y,wall);
      if(t>=1-1e-7) continue;
      if(elevated && wall.top!==undefined && start+(z0+t*(z1-z0))/px>=wall.top-1e-6) continue;
      return wall;
    }
  };
  const clear=(a:Vec,z0:number,b:Vec,z1:number)=>!blocker(a,z0,b,z1);
  // A line emits parallel rays from its entire near face. Trace backwards in
  // the cast direction. At each crossing, remove only the vertical interval
  // whose rays start upstream of the wall and pass below its top.
  function beamReaches(p:Vec,lo:number,hi:number) {
    if(!walls.length || cos<1e-10) return true;
    const x=(p.x-a.x)*ux+(p.y-a.y)*uy;
    let visible:[number,number][]=[[lo,hi]];
    for(const wall of walls) {
      if(wall.one && sideOf(wall,p)===wall.one) continue;
      const back=rayHit(p,-ux,-uy,wall);
      if(!Number.isFinite(back)) continue;
      // The ray starts on the near face when its axial coordinate is zero.
      // At the wall its axial coordinate is x*cos + z*sin - back/cos.
      const threshold=back/cos-x*cos;
      let lower=-Infinity,upper=Infinity;
      if(Math.abs(sin)<1e-10) { if(threshold>eps) continue; }
      else if(sin>0) lower=(threshold-eps)/sin;
      else upper=(threshold-eps)/sin;
      if(elevated && wall.top!==undefined) upper=Math.min(upper,(wall.top-start)*px+back*sin/cos-eps);
      if(lower>upper) continue;
      const next:[number,number][]=[];
      for(const [bottom,top] of visible) {
        if(upper<bottom || lower>top) { next.push([bottom,top]); continue; }
        if(bottom<lower) next.push([bottom,lower]);
        if(top>upper) next.push([upper,top]);
      }
      if(!next.length) return false;
      visible=next;
    }
    return true;
  }
  const axisZ=(p:Vec)=>run ? rise*clamp(((p.x-a.x)*ux+(p.y-a.y)*uy)/run,0,1) : 0;
  // Only build routes if a straight ray actually hits a wall. Neighbor links
  // cross the same finite walls as direct rays and consume actual travel distance.
  const step=Math.max(grid.cell/3,Math.max(bounds.w,bounds.h)/80);
  const reach=aimed ? Math.hypot(length,d.k==='cone' ? length/2 : half*Math.SQRT2) : radius;
  type Station={p:Vec;z:number;cost:number};
  let routes:Map<string,Station>|undefined;
  function travel(from:Vec,z0:number,to:Vec,z1:number) {
    if(own && (from===a || pointInPoly(from,own))) {
      if(pointInPoly(to,own)) return Math.abs(z1-z0);
      const f=Math.min(1,...own.map((v,i)=>rayHit(from,to.x-from.x,to.y-from.y,{a:v,b:own[(i+1)%own.length]})));
      return Math.hypot(distance(from,to)*(1-f),z1-z0);
    }
    return Math.hypot(distance(from,to),z1-z0);
  }
  function around(p:Vec,z:number,first:Seg) {
    // A single exposed tip gives an exact detour without rasterizing a short wall.
    for(const [tip,other] of [[first.a,first.b],[first.b,first.a]]) {
      const len=distance(tip,other) || 1;
      const q={x:tip.x+(tip.x-other.x)*.001/len,y:tip.y+(tip.y-other.y)*.001/len};
      const qz=axisZ(q);
      if(onMap(q,world.maps) && slice(q) && travel(a,0,q,qz)+travel(q,qz,p,z)<=reach+eps &&
        clear(a,0,q,qz) && clear(q,qz,p,z)) return true;
    }
    const key=(i:number,j:number)=>i+','+j;
    if(!routes) {
      routes=new Map();
      const queue=[{i:0,j:0}];
      routes.set('0,0',{p:a,z:0,cost:0});
      for(let n=0;n<queue.length;n++) {
        const {i,j}=queue[n], cur=routes.get(key(i,j))!;
        for(let dj=-1;dj<=1;dj++) for(let di=-1;di<=1;di++) {
          if(!di && !dj) continue;
          const ni=i+di,nj=j+dj, id=key(ni,nj);
          // Offset lattice points slightly so a wall on a grid line cannot be
          // crossed in two hops that both end exactly on the wall.
          const q={x:a.x+(ni+.013)*step,y:a.y+(nj+.019)*step};
          const qz=axisZ(q),cost=cur.cost+travel(cur.p,cur.z,q,qz);
          if(cost>reach+eps || cost>=(routes.get(id)?.cost ?? Infinity)-eps || !onMap(q,world.maps)) continue;
          if(!slice(q) && !(own && pointInPoly(q,own))) continue;
          if(!clear(cur.p,cur.z,q,qz)) continue;
          routes.set(id,{p:q,z:qz,cost});queue.push({i:ni,j:nj});
        }
      }
    }
    const i=Math.round((p.x-a.x)/step),j=Math.round((p.y-a.y)/step);
    for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      const q=routes.get(key(i+dx,j+dy));
      if(q && q.cost+travel(q.p,q.z,p,z)<=reach+eps && clear(q.p,q.z,p,z)) return true;
    }
    return false;
  }
  function hits(p:Vec,lowFt?:number,highFt=lowFt) {
    if(!onMap(p,world.maps)) return false;
    const span=slice(p);
    if(!span) return false;
    let [lo,hi]=span;
    if(elevated && lowFt!==undefined) {
      lo=Math.max(lo,(lowFt-start)*px);hi=Math.min(hi,(highFt!-start)*px);
      if(lo>hi+eps) return false;
    }
    if(d.k==='beam') return beamReaches(p,lo,hi);
    // A higher point in this same interval clears every wall a lower ray clears.
    const z=lowFt===undefined ? clamp(axisZ(p),lo,hi) : hi;
    const first=blocker(a,0,p,z);
    if(!first) return true;
    if(settings.wrap===false) return false;
    const nearest=clamp(axisZ(p),lo,hi);
    return around(p,nearest,first) || (z!==nearest && around(p,z,first));
  }
  function cells(sampling:GridSettings=grid,groundOnly=false) {
    const out:Vec[]=[], seen=new Set<string>();
    const area={x:bounds.x-eps,y:bounds.y-eps,w:bounds.w+2*eps,h:bounds.h+2*eps};
    const maps=world.maps?.length ? world.maps : [area];
    const chunk=sampling.cell*32;
    for(const map of maps) {
      const right=Math.min(area.x+area.w,map.x+map.w), bottom=Math.min(area.y+area.h,map.y+map.h);
      for(let y=Math.max(area.y,map.y);y<=bottom;y+=chunk) for(let x=Math.max(area.x,map.x);x<=right;x+=chunk) {
        for(const p of cellCentersIn(sampling,{x,y,w:Math.min(chunk,right-x),h:Math.min(chunk,bottom-y)})) {
          const id=p.x+','+p.y;
          if(seen.has(id)) continue;
          seen.add(id);
          if(hits(p,groundOnly ? ground(p) : undefined)) out.push(p);
          if(!world.maps?.length && out.length>=MAX_COVERED && sampling===grid) return out;
        }
      }
    }
    return out;
  }
  return {geom,bounds,hits,cells,hasWalls:walls.length>0,feet:axis.feet};
}
