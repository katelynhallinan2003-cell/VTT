import type { Polygon } from 'polygon-clipping';
import type { GradientControl, Vec } from '../types';
import type { HeightPatch } from './autoHeight';
import { boundarySplits } from './gradientBoundaries';
import { groundAtTerrain, slopeAt, type Terrain } from './terrain';
import { inRegion, terrainLayers } from './terrainEdges';

type Neighbor = { index: number; polygon: Polygon; height: number; painted: boolean };
export interface Contact {
  key: string;
  path: Vec[];
  neighbor: number;
  height: number;
  painted: boolean;
}
const pointKey = (p: Vec) => p.x.toFixed(5)+','+p.y.toFixed(5);
const distance = (a: Vec,b: Vec) => Math.hypot(a.x-b.x,a.y-b.y);
const between = (a: Vec,b: Vec,t: number) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});

function segments(polygon: Polygon) {
  return polygon.flatMap(ring => ring.flatMap(([x,y],i) => {
    const [xx,yy]=ring[(i+1)%ring.length];
    return x===xx && y===yy ? [] : [{a:{x,y},b:{x:xx,y:yy}}];
  }));
}

function bounds(polygon: Polygon) {
  const xs=polygon[0].map(p=>p[0]), ys=polygon[0].map(p=>p[1]);
  return {left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)};
}

/** Index the finished outlines, after clipping away all hand-painted terrain.
 * Looking up edge choices never changes the geometry that will be saved. */
export function regionContacts(patches: HeightPatch[], terrain: Terrain) {
  const neighbors:Neighbor[]=patches.map((p,index)=>({...p,index,painted:false}));
  terrainLayers(terrain).forEach(({area,shape},i)=>{
    for (const polygon of shape) neighbors.push({index:-1-i,polygon,height:area.h,painted:true});
  });
  const indexed=neighbors.map(n=>({...n,b:bounds(n.polygon),segments:segments(n.polygon)}));
  const cache=new Map<number,Contact[]>();
  return (index:number):Contact[] => {
    const known=cache.get(index);
    if (known) return known;
    const region=indexed[index], b=region.b;
    const nearby=indexed.filter(n=>n.index!==index && n.b.left<=b.right && n.b.right>=b.left &&
      n.b.top<=b.bottom && n.b.bottom>=b.top).reverse();
    const edges=nearby.flatMap(n=>n.segments), result:Contact[]=[];
    for (const ring of region.polygon) {
      const runs:{neighbor?:Neighbor; path:Vec[]; sample:Vec}[]=[];
      for (const {a,b} of segments([ring])) {
        const cuts=boundarySplits(a,b,edges), len=distance(a,b);
        for (let k=1;k<cuts.length;k++) {
          const from=between(a,b,cuts[k-1]), to=between(a,b,cuts[k]);
          const sample=between(from,to,.5), offset=Math.min(1e-4,distance(from,to)*1e-4)/len;
          sample.x+=(b.y-a.y)*offset; sample.y-=(b.x-a.x)*offset;
          const n=nearby.find(v=>sample.x>=v.b.left && sample.x<=v.b.right && sample.y>=v.b.top &&
            sample.y<=v.b.bottom && inRegion(v.polygon,sample));
          const last=runs.at(-1);
          if (last && last.neighbor?.index===n?.index) last.path.push(to);
          else runs.push({neighbor:n,path:[from,to],sample});
        }
      }
      const first=runs[0], last=runs.at(-1);
      if (last && first!==last && first.neighbor?.index===last.neighbor?.index) {
        first.path=[...last.path,...first.path.slice(1)]; runs.pop();
      }
      for (const {neighbor:n,path,sample} of runs) {
        if (!n) continue; // map border
        for (const section of contactSections(path)) {
          const length=section.slice(1).reduce((sum,p,i)=>sum+distance(section[i],p),0);
          const ends=[pointKey(section[0]),pointKey(section.at(-1)!)].sort();
          // Two arcs can have the same endpoints and length. A point halfway
          // along distinguishes the sides, even when traced in reverse.
          let remaining=length/2, mid=section[0];
          for (let i=1;i<section.length;i++) {
            const span=distance(section[i-1],section[i]);
            if (span>=remaining) { mid=between(section[i-1],section[i],remaining/span); break; }
            remaining-=span;
          }
          result.push({key:[...ends,pointKey(mid)].join('/'),path:section,neighbor:n.index,
            painted:n.painted,height:n.painted ? groundAtTerrain(terrain,sample) : n.height});
        }
      }
    }
    cache.set(index,result);
    return result;
  };
}

/** An island touching one surrounding region still has independently selectable sides. */
function contactSections(path: Vec[]) {
  if (distance(path[0],path.at(-1)!)>1e-7) return [path];
  const ring=path.slice(0,-1);
  const order=(a:Vec,b:Vec)=>a.x-b.x || a.y-b.y;
  const left=ring.reduce((best,p,i)=>order(p,ring[best])<0 ? i : best,0);
  const cycle=[...ring.slice(left),...ring.slice(0,left),ring[left]];
  const right=cycle.reduce((best,p,i)=>order(p,cycle[best])>0 ? i : best,0);
  return [cycle.slice(0,right+1),cycle.slice(right)].filter(span=>span.length>=2);
}

export function regionControls(patch:HeightPatch, contacts:Contact[], smooth:Set<string>,
  otherGradients:Set<number>, pins:(Vec & {height:number})[], terrain:Terrain, spacing:number):GradientControl[] {
  const controls:GradientControl[]=pins.filter(p=>inRegion(patch.polygon,p))
    .map(({x,y,height},i)=>({id:'mark-'+i,height,path:[{x,y}]}));
  if (!controls.length) {
    // A midpoint inside the longest filled span also works for concave pieces and cutouts.
    const b=bounds(patch.polygon);
    let widest=0, anchor:Vec|undefined;
    for (const fraction of [.5,.25,.75]) {
      const y=b.top+(b.bottom-b.top)*fraction, xs:number[]=[];
      for (const {a,b} of segments(patch.polygon)) if ((a.y>y)!==(b.y>y)) xs.push(a.x+(b.x-a.x)*(y-a.y)/(b.y-a.y));
      xs.sort((a,b)=>a-b);
      for(let i=1;i<xs.length;i+=2) if (xs[i]-xs[i-1]>widest) {
        widest=xs[i]-xs[i-1]; anchor={x:(xs[i]+xs[i-1])/2,y};
      }
    }
    if (anchor) controls.push({id:'center',height:patch.height,path:[anchor]});
  }
  for (const c of contacts) {
    if (!smooth.has(c.key)) continue;
    const id='edge-'+controls.length;
    if (!c.painted || !terrain.areas.some(a=>a.gradientEnabled || a.add)) {
      controls.push({id,path:c.path,height:otherGradients.has(c.neighbor) ? (patch.height+c.height)/2 : c.height});
      continue;
    }
    // Bake a varying neighboring surface into one editable line. Sample its
    // actual height at the boundary, refining until linear interpolation is
    // more accurate than the tolerance used to decide whether a wall exists.
    const path:GradientControl['path']=[];
    let base=0;
    for (let i=1;i<c.path.length;i++) {
      const a=c.path[i-1], b=c.path[i], len=distance(a,b);
      if (!len) continue;
      const probe=between(a,b,.5), offset=Math.min(len*1e-4,1e-5)/len;
      probe.x+=(b.y-a.y)*offset; probe.y-=(b.x-a.x)*offset;
      const flat=groundAtTerrain(terrain,probe), slope=slopeAt(terrain,probe), sample=slope ?? (()=>flat);
      const start=sample(a);
      if (!path.length) { base=start; path.push({...a,rise:0}); }
      const append=(from:Vec,h0:number,to:Vec,h1:number,depth:number)=>{
        const mid=between(from,to,.5), hm=sample(mid);
        if (depth<16 && (distance(from,to)>spacing || Math.abs(hm-(h0+h1)/2)>.00015)) {
          append(from,h0,mid,hm,depth+1); append(mid,hm,to,h1,depth+1);
        } else path.push({...to,rise:h1-base});
      };
      if (slope) append(a,start,b,sample(b),0);
      else path.push({...b,rise:flat-base});
    }
    if (path.length) controls.push({id,height:base,path:path.every(p=>p.rise===0) ? c.path : path});
  }
  return controls;
}
