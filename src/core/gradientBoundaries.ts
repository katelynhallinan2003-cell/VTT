import clip, { type MultiPolygon, type Pair } from 'polygon-clipping';
import type { Drawing, GradientControl, GridSettings, Vec } from '../types';
import { terrainOf, type Terrain } from './terrain';
import { inRegion, patchStroke, terrainLayers } from './terrainEdges';
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
function splits(a:Vec,b:Vec,others:ReturnType<typeof edges>) {
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
    const a=path[i-1],b=path[i],cuts=splits(a,b,outline);
    for(let j=1;j<cuts.length;j++) {
      if(!locate(shape,along(a,b,(cuts[j-1]+cuts[j])/2),1e-5)) { run=undefined; continue; }
      if(!run) { run=[along(a,b,cuts[j-1])]; runs.push(run); }
      run.push(along(a,b,cuts[j]));
    }
  }
  const length=(p:Vec[])=>p.reduce((sum,v,i)=>sum+(i?distance(v,p[i-1]):0),0);
  return runs.sort((a,b)=>length(b)-length(a))[0] ?? [];
}

export function resolveGradientBoundaries(t:Terrain) {
  const layers=terrainLayers(t);
  for(const layer of layers) {
    const {area}=layer;
    if(!area.gradientEnabled) continue;
    const stored=area.gradient ?? [];
    const neighbors=layers.filter(l=>l!==layer && l.area.b.x<=area.b.x+area.b.w && l.area.b.x+l.area.b.w>=area.b.x &&
      l.area.b.y<=area.b.y+area.b.h && l.area.b.y+l.area.b.h>=area.b.y);
    // Older scenes can already contain flat paint covering a gradient.
    const covers=neighbors.filter(l=>l.area.order>area.order && !l.area.add && !l.area.gradientEnabled);
    if(covers.length) layer.shape=clip.difference(layer.shape,...covers.map(l=>l.shape));
    const shape=layer.shape, neighborEdges=neighbors.flatMap(l=>edges(l.shape));
    const defaults:GradientControl[]=[], count=new Map<string,number>();
    for(const poly of shape) for(const ring of poly) {
      const runs:{key:string;height:number;path:Vec[]}[]=[];
      for(let i=1;i<ring.length;i++) {
        const a=vec(ring[i-1]),b=vec(ring[i]),len=distance(a,b);
        if(len<eps) continue;
        const cuts=splits(a,b,neighborEdges);
        for(let j=1;j<cuts.length;j++) {
          const p=along(a,b,(cuts[j-1]+cuts[j])/2);
          // Clipping rings keep the filled ground to their left, including holes.
          const n=Math.min(t.grid.cell*1e-5,len*(cuts[j]-cuts[j-1])*1e-4)/len;
          p.x+=n*(b.y-a.y); p.y-=n*(b.x-a.x);
          let key='',height=0,flat=true;
          for(const l of neighbors) if(l.shape.some(poly=>inRegion(poly,p))) {
            if(!l.area.add || l.area.gradientEnabled) { height=0; flat=!l.area.gradientEnabled; }
            height+=l.area.h;
            key=flat ? l.area.id : '';
          }
          const last=runs.at(-1);
          if(last && last.key===key && last.height===height) last.path.push(along(a,b,cuts[j]));
          else runs.push({key,height,path:[along(a,b,cuts[j-1]),along(a,b,cuts[j])]});
        }
      }
      const first=runs[0], last=runs.at(-1);
      if(first && last && first!==last && first.key===last.key && first.height===last.height) {
        first.path=[...last.path,...first.path.slice(1)]; runs.pop();
      }
      for(const run of runs) if(run.key) {
        const index=count.get(run.key) ?? 0;
        defaults.push({id:'join:'+run.key+':'+index,height:run.height,path:run.path});
        count.set(run.key,index+1);
      }
    }
    area.boundaryDefaults=defaults;
    const outline=edges(shape);
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
    if(area.gradient.length===1 && shared(area.gradient[0].id)) { area.h=area.gradient[0].height; area.add=false; }
  }
}

/** Write only explicit overrides so a matching line follows future edits to its neighbor. */
export function storedControls(defaults:GradientControl[],desired:GradientControl[],previous:GradientControl[]) {
  const out=desired.filter(c=>!shared(c.id));
  for(const base of defaults) {
    const c=desired.find(c=>c.id===base.id);
    if(!c) { out.push({...base,boundary:'hidden'}); continue; }
    const height=c.height!==base.height;
    const path=c.path.length!==base.path.length || c.path.some((p,i)=>distance(p,base.path[i])>eps);
    if(height || path) out.push({...c,boundary:height && path ? 'both' : height ? 'height' : 'path'});
  }
  return [...out,...previous.filter(c=>shared(c.id) && !defaults.some(d=>d.id===c.id))];
}

/** Persist a cut in the gradient's group, independently of the covering flat stroke. */
export function gradientCutsForPaint(existing:Drawing[],added:Drawing[],grid:GridSettings) {
  const flats=added.filter(d=>d.hz!=null && !d.he && !d.dt && !d.dl && !d.gradientEnabled && !d.gradient?.length);
  if(!flats.length || !existing.some(d=>d.gradientEnabled || d.gradient?.length)) return [];
  const ground=terrainOf(existing,grid);
  const gradients=terrainLayers(ground).filter(l=>l.area.gradientEnabled);
  const incoming=terrainLayers(terrainOf(flats,grid)).filter(l=>!gradients.some(g=>g.area.id===l.area.id));
  return gradients.flatMap(g=>incoming.flatMap(l=>clip.intersection(g.shape,l.shape).map(poly=>patchStroke(poly,g.area.id,null))));
}
