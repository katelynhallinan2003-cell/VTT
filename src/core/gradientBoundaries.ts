import clip, { type MultiPolygon, type Pair } from 'polygon-clipping';
import type { GradientControl, Vec } from '../types';
import {groundAtTerrain, slopeAt, type Area, type Terrain} from './terrain';
import { areaShape, inRegion, terrainLayers } from './terrainEdges';
import { locate } from './gradientGeometry';

const eps = 1e-7;
const distance = (a:Vec,b:Vec) => Math.hypot(a.x-b.x,a.y-b.y);
const along = (a:Vec,b:Vec,t:number):Vec => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const vec = ([x,y]:Pair):Vec => ({x,y});
const shared = (id:string) => id.startsWith('join:');

function edges(shape:MultiPolygon) {
  return shape.flatMap(poly=>poly.flatMap(r=>r.slice(1).map((p,i)=>({a:vec(r[i]),b:vec(p)}))));
}

/** Split at crossings and at both ends of collinear overlaps. */
export function boundarySplits(a:Vec,b:Vec,others:ReturnType<typeof edges>) {
  const dx=b.x-a.x, dy=b.y-a.y, len=dx*dx+dy*dy, cuts=[0,1];
  if (!len) return cuts;
  const put=(t:number)=>{ if(t>eps && t<1-eps) cuts.push(t); };
  for(const {a:p,b:q} of others) {
    if (Math.max(p.x,q.x)<Math.min(a.x,b.x)-eps || Math.min(p.x,q.x)>Math.max(a.x,b.x)+eps ||
        Math.max(p.y,q.y)<Math.min(a.y,b.y)-eps || Math.min(p.y,q.y)>Math.max(a.y,b.y)+eps) continue;
    const ex=q.x-p.x, ey=q.y-p.y, x=p.x-a.x, y=p.y-a.y, det=dx*ey-dy*ex;
    if(Math.abs(det)>eps) {
      const u=(x*dy-y*dx)/det;
      if(u>=-eps && u<=1+eps) put((x*ey-y*ex)/det);
    } else if(Math.abs(x*dy-y*dx)<=eps*Math.sqrt(len)) {
      put((x*dx+y*dy)/len);
      put(((q.x-a.x)*dx+(q.y-a.y)*dy)/len);
    }
  }
  return cuts.sort((l,r)=>l-r).filter((t,i,all)=>!i || t-all[i-1]>eps);
}

function trim(path:Vec[],shape:MultiPolygon,outline:ReturnType<typeof edges>):Vec[] {
  if(path.length===1) return locate(shape,path[0],1e-5) ? path : [];
  const runs:Vec[][]=[];
  let run:Vec[] | undefined;
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i],cuts=boundarySplits(a,b,outline);
    for(let j=1;j<cuts.length;j++) {
      if(!locate(shape,along(a,b,(cuts[j-1]+cuts[j])/2),1e-5)) { run=undefined; continue; }
      if(!run) { run=[along(a,b,cuts[j-1])]; runs.push(run); }
      run.push(along(a,b,cuts[j]));
    }
  }
  const length=(p:Vec[])=>p.reduce((sum,v,i)=>sum+(i?distance(v,p[i-1]):0),0);
  return runs.sort((a,b)=>length(b)-length(a))[0] ?? [];
}

type BoundaryRun={key:string; height:number; path:Vec[]; bare:boolean; id?:string};

/** Join along the ring itself, including short breaks left by a round brush.
 * Existing individually edited lines and actual changes of height divide the run. */
function joinedBoundary(runs:BoundaryRun[],cell:number,protectedIds:Set<string>):GradientControl[] {
  const size=(r:BoundaryRun)=>r.path.reduce((sum,p,i)=>sum+(i ? distance(p,r.path[i-1]) : 0),0);
  const lengths=runs.map(size), perimeter=lengths.reduce((a,b)=>a+b,0);
  const same=(a:BoundaryRun,b:BoundaryRun)=>!!a.id && !!b.id && a.height===b.height &&
    !protectedIds.has(a.id) && !protectedIds.has(b.id);
  const contact=lengths.reduce((sum,len,i)=>sum+(runs[i].id ? len : 0),0);
  const gap=Math.max(cell,contact>perimeter*.75 ? perimeter*.1 : 0);
  const effective=runs.map((run,i)=>{
    if (!run.bare || lengths[i]>gap) return run;
    const prev=runs[(i+runs.length-1)%runs.length], next=runs[(i+1)%runs.length];
    return prev!==next && same(prev,next) ? {...run,id:prev.id,height:prev.height} : run;
  });
  const start=effective.findIndex((r,i)=>!same(r,effective[(i+effective.length-1)%effective.length]));
  const result:GradientControl[]=[];
  let group:BoundaryRun[]=[];
  const flush=()=>{
    if (!group.length) return;
    const ids=[...new Set(group.map(r=>r.id!))].sort();
    const path=group.flatMap((r,i)=>i ? r.path.slice(1) : r.path);
    result.push({id:ids.length===1 ? ids[0] : 'join:merged:'+ids[0],height:group[0].height,path});
    group=[];
  };
  for(let i=0;i<effective.length;i++) {
    const run=effective[(Math.max(0,start)+i)%effective.length];
    if (group.length && !same(group[group.length-1],run)) flush();
    if (run.id) group.push(run);
  }
  flush();
  return result;
}

type Layer=ReturnType<typeof terrainLayers>[number];
const boundaryCache=new WeakMap<MultiPolygon,{ neighbors:MultiPolygon[]; key:string; shape:MultiPolygon; defaults:GradientControl[]; outline:ReturnType<typeof edges> }>();

function boundaryShape(layer:Layer, neighbors:Layer[], cell:number, protectedIds:Set<string>, original?:Terrain) {
  const area=layer.area;
  const key=JSON.stringify([cell,original?.sig,area.order,[...protectedIds].sort(),...neighbors.map(l=>[l.area.id,l.area.order,l.area.h,l.area.add,l.area.gradientEnabled])]);
  const cached=boundaryCache.get(layer.shape);
  if (cached?.key===key && neighbors.every((l,i)=>l.shape===cached.neighbors[i])) return cached;
  // Older scenes can already contain flat paint covering a gradient.
  const covers=neighbors.filter(l=>l.area.order>area.order && !l.area.add && !l.area.gradientEnabled);
  const shape=covers.length ? clip.difference(layer.shape,...covers.map(l=>l.shape)) : layer.shape;
  const neighborEdges=neighbors.flatMap(l=>edges(l.shape));
  const defaults:GradientControl[]=[], count=new Map<string,number>();
  for(const poly of shape) for(const ring of poly) {
    const runs:BoundaryRun[]=[];
    for(let i=1;i<ring.length;i++) {
      const a=vec(ring[i-1]),b=vec(ring[i]),len=distance(a,b);
      if(len<eps) continue;
      const cuts=boundarySplits(a,b,neighborEdges);
      for(let j=1;j<cuts.length;j++) {
        const p=along(a,b,(cuts[j-1]+cuts[j])/2);
        // Clipping rings keep the filled ground to their left, including holes.
        const n=Math.min(cell*1e-5,len*(cuts[j]-cuts[j-1])*1e-4)/len;
        p.x+=n*(b.y-a.y); p.y-=n*(b.x-a.x);
        let key='',height=0,flat=true,bare=true;
        for(const l of neighbors) if(l.shape.some(poly=>inRegion(poly,p))) {
          bare=false;
          if(!l.area.add || l.area.gradientEnabled) { height=0; flat=!l.area.gradientEnabled; }
          height+=l.area.h;
          key=flat ? l.area.id : '';
        }
        if (key && original) {
          const inside={x:p.x-2*n*(b.y-a.y),y:p.y+2*n*(b.x-a.x)};
          const from=area.add ? groundAtTerrain(original,inside) : area.h;
          if (Math.abs(height-from)>=15) key='';
        }
        const last=runs.at(-1);
        if(last && last.key===key && last.height===height && last.bare===bare) last.path.push(along(a,b,cuts[j]));
        else runs.push({key,height,bare,path:[along(a,b,cuts[j-1]),along(a,b,cuts[j])]});
      }
    }
    const first=runs[0], last=runs.at(-1);
    if(first && last && first!==last && first.key===last.key && first.height===last.height && first.bare===last.bare) {
      first.path=[...last.path,...first.path.slice(1)]; runs.pop();
    }
    for(const run of runs) if(run.key) {
      const index=count.get(run.key) ?? 0;
      run.id='join:'+run.key+':'+index;
      count.set(run.key,index+1);
    }
    defaults.push(...joinedBoundary(runs,cell,protectedIds));
  }
  const result={key,neighbors:neighbors.map(l=>l.shape),shape,defaults,outline:edges(shape)};
  boundaryCache.set(layer.shape,result);
  return result;
}

function nearbyLayers(layer:Layer,layers:Layer[]) {
  const {b}=layer.area;
  return layers.filter(l=>l!==layer && l.area.b.x<=b.x+b.w && l.area.b.x+l.area.b.w>=b.x &&
    l.area.b.y<=b.y+b.h && l.area.b.y+l.area.b.h>=b.y);
}

export function initialBoundaryControls(t:Terrain, id:string) {
  const layers=terrainLayers(t);
  const layer=layers.find(l=>l.area.id===id);
  return layer ? boundaryShape(layer,nearbyLayers(layer,layers),t.grid.cell,new Set(),t).defaults : [];
}

/** Resolve maps from before boundary controls were stored in full. */
export function resolveGradientBoundaries(t:Terrain) {
  const layers=terrainLayers(t);
  for(const layer of layers) {
    const {area}=layer;
    if(!area.gradientEnabled || area.gradientFixed) continue;
    const stored=area.gradient ?? [];
    const neighbors=nearbyLayers(layer,layers);
    const {shape,defaults,outline}=boundaryShape(layer,neighbors,t.grid.cell,new Set(stored.filter(c=>shared(c.id) && !c.id.startsWith('join:merged:')).map(c=>c.id)));
    layer.shape=shape;
    area.boundaryDefaults=defaults;
    const visible=(c:GradientControl) => {
      const path=trim(c.path,shape,outline);
      return path.length ? [{...c,path}] : [];
    };
    area.gradient=[...defaults.flatMap(c=>{
      const saved=stored.find(s=>s.id===c.id);
      if(saved?.boundary==='hidden') return [];
      const height=saved?.boundary==='both' || saved?.boundary==='height' ? saved.height : c.height;
      return saved?.boundary==='both' || saved?.boundary==='path' ? visible({...c,height,path:saved.path}) : [{...c,height}];
    }),...stored.filter(c=>!shared(c.id)).flatMap(visible)];
  }
}

/** Build numerical profiles for the solver while keeping the editable controls compact.
 * Resolve dependencies once. In a reciprocal match the first visit supplies the
 * authored seam, so both sides settle on the same profile without recursion. */
export function resolveMatchedLines(t:Terrain) {
  const layers=terrainLayers(t),visited=new Set<Area>();
  function resolve(area:Area) {
    if (visited.has(area) || !area.gradient?.some(c=>c.match)) return;
    visited.add(area);
    const outline=areaShape(t,area.id);
    const other=layers.filter(l=>l.area!==area);
    const outside={...t,areas:other.map(l=>l.area)};
    const neighboringEdges=other.flatMap(l=>edges(l.shape));
    const controls=area.gradient;
    area.gradient=controls.map(c=>{
      if (!c.match || c.path.length<2) return c;
      const profile:(Vec & {rise:number})[]=[];
      for(let i=1;i<c.path.length;i++) {
        const a=c.path[i-1],b=c.path[i],len=distance(a,b);
        if (!len) continue;
        const cuts=boundarySplits(a,b,neighboringEdges);
        for(let j=1;j<cuts.length;j++) {
          const from=along(a,b,cuts[j-1]),to=along(a,b,cuts[j]),m=along(from,to,.5);
          const shift=Math.min(t.grid.cell*.0001,distance(from,to)*.01)/len;
          const nx=(a.y-b.y)*shift,ny=(b.x-a.x)*shift;
          const l={x:m.x+nx,y:m.y+ny},r={x:m.x-nx,y:m.y-ny};
          const inL=outline.some(poly=>inRegion(poly,l)),inR=outline.some(poly=>inRegion(poly,r));
          const q=inL ? r : l;
          const touching=inL!==inR;
          if(touching) for (const layer of other) if (layer.shape.some(poly=>inRegion(poly,q))) resolve(layer.area);
          const slope=touching && slopeAt(outside,q);
          const flat=touching ? groundAtTerrain(outside,q) : c.height;
          const at=(p:Vec)=>slope ? slope(p) : flat;
          const append=(p:Vec,h:number)=>{
            const last=profile[profile.length-1];
            if(!last || distance(last,p)>eps || Math.abs(last.rise-h)>eps) profile.push({...p,rise:h});
          };
          const split=(p:Vec,v:number,end:Vec,w:number,depth:number)=>{
            const mid=along(p,end,.5),h=at(mid);
            if(slope && depth<12 && (distance(p,end)>t.grid.cell/4 ||
              [.25,.5,.75].some(f=>Math.abs(at(along(p,end,f))-(v+(w-v)*f))>.00025))) {
              split(p,v,mid,h,depth+1); split(mid,h,end,w,depth+1);
            } else append(end,w);
          };
          append(from,at(from)); split(from,at(from),to,at(to),0);
        }
      }
      if(!profile.length) return c;
      const height=profile[0].rise;
      return {...c,height,path:profile.map(p=>({...p,rise:p.rise-height}))};
    });
    area.editControls=controls.map((c,i)=>c.match ? {...c,height:area.gradient![i].height} : c);
  }
  for(const area of t.areas) resolve(area);
}
