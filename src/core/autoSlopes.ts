import type { Polygon } from 'polygon-clipping';
import type { GradientControl, Vec } from '../types';
import { heightPolygons, type Analysis, type HeightMark } from './autoHeight';
import { inRegion } from './terrainEdges';

interface RegionVotes {
  counts: Map<number, number>;
  marks: Set<number>;
  size: number;
  sumX: number;
  sumY: number;
  seams: number;
  sharp: number;
}

/** A sharp picture edge already splits the natural patches. Look for a proposed
 * height boundary cutting through the interior of one continuous patch instead. */
export function slopeRegions(map: Analysis, labels: Int16Array, marks: HeightMark[]) {
  const ids = Int32Array.from(labels), levels = new Map<number, number[]>();
  if (!marks.some(m => m.height !== marks[0].height)) return {ids,levels};
  const votes = new Map<number, RegionVotes>();
  for (let i=0;i<labels.length;i++) {
    if (!map.opaque[i]) continue;
    const id=map.region[i], h=labels[i];
    let v=votes.get(id);
    if (!v) {
      v={counts:new Map(),marks:new Set(),size:0,sumX:0,sumY:0,seams:0,sharp:0};
      votes.set(id,v);
    }
    v.size++; v.sumX+=i%map.width; v.sumY+=Math.floor(i/map.width);
    v.counts.set(h,(v.counts.get(h) ?? 0)+1);
    for (let dir=0;dir<2;dir++) {
      const j=i+(dir ? map.width : 1);
      if ((!dir && i%map.width===map.width-1) || !map.opaque[j] || map.region[j]!==id || labels[j]===h) continue;
      v.seams++;
      if (map.contrast[2*i+dir]>=12) v.sharp++;
    }
  }
  for (const m of marks) votes.get(map.region[m.y*map.width+m.x])?.marks.add(m.height);
  const assigned=new Map<number,number>(), matching=new Map<string,number>();
  for (const [region,v] of votes) {
    if (!v.seams || v.sharp>v.seams*.3) continue;
    const bands=[...v.counts].sort((a,b)=>b[1]-a[1]);
    const supported=bands.filter(([h,count])=>v.marks.has(h) || count>=Math.max(6,v.size*.12));
    if (supported.length<2) continue;
    const heights=supported.map(([h])=>h).sort((a,b)=>a-b);
    // An unmarked scrap of repeated texture is weak evidence for a ramp.
    // Require a broad crossing and limit unsupported changes to a gentle rise.
    if (v.marks.size<2 && (v.size<Math.max(36,labels.length/700) || v.seams<5 ||
        heights.at(-1)!-heights[0] >=15)) continue;
    if (supported.reduce((sum,[,count])=>sum+count,0)<v.size*.96) continue;
    const reach=Math.min(Math.min(map.width,map.height)*.2,3*Math.sqrt(v.size));
    if (heights.some(h=>!v.marks.has(h) && !marks.some(m=>m.height===h &&
      Math.hypot(m.x-v.sumX/v.size,m.y-v.sumY/v.size)<=reach))) continue;
    const key=heights.join(',');
    let id=matching.get(key);
    if (id===undefined) { id=-40000-matching.size; matching.set(key,id); levels.set(id,heights); }
    assigned.set(region,id);
  }
  for (let i=0;i<ids.length;i++) ids[i]=assigned.get(map.region[i]) ?? labels[i];
  linkNearbyMarks(map,labels,marks,ids,levels);
  keepLevelEnds(ids,labels,marks,levels,map.width);
  return {ids,levels};
}

/** Artwork can split a single grassy incline into several colour patches. Look
 * between nearby anchors as well. A third elevation, a transparent gap or a
 * sharp edge across the approach is evidence against joining those marks. */
function linkNearbyMarks(map:Analysis, labels:Int16Array, marks:HeightMark[], ids:Int32Array, levels:Map<number,number[]>) {
  type Link = {a:HeightMark; b:HeightMark; length:number};
  const links:Link[]=[];
  const maxReach=Math.min(map.width,map.height)*.48;
  for (let i=0;i<marks.length;i++) for (let j=i+1;j<marks.length;j++) {
    const a=marks[i], b=marks[j], length=Math.hypot(a.x-b.x,a.y-b.y);
    if (a.height!==b.height && length>=6 && length<=maxReach) links.push({a,b,length});
  }
  links.sort((a,b)=>a.length-b.length);
  const covered=new Set<HeightMark>();
  const at=(x:number,y:number)=>x<0 || y<0 || x>=map.width || y>=map.height ? -1 : Math.floor(y)*map.width+Math.floor(x);
  for (const {a,b,length} of links) {
    if (Math.abs(a.height-b.height)>=15 || (covered.has(a) && covered.has(b))) continue;
    const ux=(b.x-a.x)/length, uy=(b.y-a.y)/length;
    const radius=Math.max(2,Math.min(length*.24,maxReach*.2));
    let clear=0;
    for (const offset of [-.65,0,.65]) {
      let valid=true, peak=0, sum=0, steps=0;
      let prev=-1;
      for (let k=0;k<=Math.ceil(length);k++) {
        const f=k/Math.ceil(length), side=offset*radius*Math.sin(Math.PI*f);
        const x=a.x+.5+f*(b.x-a.x)-side*uy, y=a.y+.5+f*(b.y-a.y)+side*ux, p=at(x,y);
        if (p<0 || !map.opaque[p] || (labels[p]!==a.height && labels[p]!==b.height)) { valid=false; break; }
        if (prev>=0 && p!==prev) {
          const rgb=map.colors, from=prev*3, to=p*3;
          const span=Math.hypot(p%map.width-prev%map.width,Math.floor(p/map.width)-Math.floor(prev/map.width));
          const strength=Math.hypot(rgb[from]-rgb[to],rgb[from+1]-rgb[to+1],rgb[from+2]-rgb[to+2])/(Math.sqrt(3)*span);
          peak=Math.max(peak,strength); sum+=strength; steps++;
        }
        prev=p;
      }
      if (valid && peak<18 && sum/Math.max(1,steps)<5) clear++;
    }
    if (clear<2) continue;
    const heights=[a.height,b.height].sort((l,r)=>l-r);
    let id=[...levels].find(([,hs])=>hs.length===2 && hs[0]===heights[0] && hs[1]===heights[1])?.[0];
    if (id===undefined) { id=-40000-levels.size; levels.set(id,heights); }
    const x0=Math.max(0,Math.floor(Math.min(a.x,b.x)-radius)), x1=Math.min(map.width-1,Math.ceil(Math.max(a.x,b.x)+radius));
    const y0=Math.max(0,Math.floor(Math.min(a.y,b.y)-radius)), y1=Math.min(map.height-1,Math.ceil(Math.max(a.y,b.y)+radius));
    for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
      const p=y*map.width+x;
      if (!map.opaque[p] || (labels[p]!==a.height && labels[p]!==b.height) || (ids[p]<-32768 && ids[p]!==id)) continue;
      const along=(x-a.x)*ux+(y-a.y)*uy, across=(y-a.y)*ux-(x-a.x)*uy;
      if (across*across + (along-Math.max(0,Math.min(length,along)))**2 <= radius*radius) ids[p]=id;
    }
    covered.add(a); covered.add(b);
  }
}

/** With a marked foot and crest, stop the incline at those stations. The cuts
 * become editable contour lines, keeping the ground beyond the crest level. */
function keepLevelEnds(ids:Int32Array, labels:Int16Array, marks:HeightMark[], levels:Map<number,number[]>, w:number) {
  const seen=new Uint8Array(ids.length), queue=new Int32Array(ids.length);
  const anchors=new Map(marks.map(m=>[m.y*w+m.x,m]));
  for (let i=0;i<ids.length;i++) {
    const range=levels.get(ids[i]);
    if (seen[i] || range?.length!==2) continue;
    const pins:HeightMark[]=[];
    let end=1; seen[i]=1; queue[0]=i;
    const visit=(j:number)=>{
      if (!seen[j] && ids[j]===ids[i]) { seen[j]=1; queue[end++]=j; }
    };
    for (let k=0;k<end;k++) {
      const cell=queue[k], pin=anchors.get(cell);
      if (pin) pins.push(pin);
      if (cell%w) visit(cell-1);
      if (cell%w<w-1) visit(cell+1);
      if (cell>=w) visit(cell-w);
      if (cell+w<ids.length) visit(cell+w);
    }
    const low=pins.filter(p=>p.height===range[0]), high=pins.filter(p=>p.height===range[1]);
    if (!low.length || !high.length) continue;
    const mean=(pins:HeightMark[],axis:'x'|'y')=>pins.reduce((s,p)=>s+p[axis],0)/pins.length;
    const dx=mean(high,'x')-mean(low,'x'), dy=mean(high,'y')-mean(low,'y'), len=Math.hypot(dx,dy);
    if (len<4) continue;
    const station=(x:number,y:number)=>(x*dx+y*dy)/len;
    const positions=pins.map(p=>station(p.x,p.y));
    const start=Math.min(...positions)-.5, stop=Math.max(...positions)+.5;
    for (let k=0;k<end;k++) {
      const p=queue[k], t=station(p%w,Math.floor(p/w));
      if (t<start || t>stop) ids[p]=labels[p];
    }
  }
}

type Run = {height:number | undefined; path:Vec[]; length:number};

/** Find the actual stretches adjoining each flat on the finished outline,
 * including around holes. Input rings use picture coordinates and face clockwise
 * around the filled region (outer positive, holes negative in screen space). */
export function slopeControls(polygon:Polygon, id:number, heights:number[], marks:HeightMark[],
  ids:Int32Array | Int16Array, labels:Int16Array, w:number): GradientControl[] {
  const runs:Run[]=[];
  for (const ring of polygon) {
    const local:Run[]=[];
    for (let i=0;i<ring.length;i++) {
      const [x,y]=ring[i], [xx,yy]=ring[(i+1)%ring.length], dx=xx-x, dy=yy-y, len=Math.hypot(dx,dy);
      if (!len) continue;
      const steps=Math.ceil(len);
      for (let s=0;s<steps;s++) {
        const t=(s+.5)/steps;
        const ox=Math.floor(x+t*dx+.55*dy/len), oy=Math.floor(y+t*dy-.55*dx/len);
        const index=oy*w+ox;
        const h=ox>=0 && ox<w && oy>=0 && index<ids.length && ids[index]!==id && heights.includes(labels[index])
          ? labels[index] : undefined;
        let run=local.at(-1);
        if (!run || run.height!==h) {
          run={height:h,path:[{x:x+s/steps*dx,y:y+s/steps*dy}],length:0}; local.push(run);
        }
        // Only corners or a change of neighbor need a stored vertex.
        const end={x:x+(s+1)/steps*dx,y:y+(s+1)/steps*dy};
        if (run.path.length>=2) {
          const a=run.path.at(-2)!, b=run.path.at(-1)!;
          if (Math.abs((b.x-a.x)*dy-(b.y-a.y)*dx)<1e-8) run.path.pop();
        }
        run.path.push(end); run.length+=len/steps;
      }
    }
    const first=local[0],last=local.at(-1);
    if (first && last && first!==last && first.height===last.height) {
      first.path=[...last.path,...first.path.slice(1)]; first.length+=last.length; local.pop();
    }
    runs.push(...local.filter(r=>r.height!==undefined && r.length>=2));
  }
  const controls:GradientControl[]=runs.map((r,i)=>({id:'edge-'+i,height:r.height!,path:r.path}));
  for (const m of marks) {
    const p={x:m.x+.5,y:m.y+.5};
    if (inRegion(polygon,p)) controls.push({id:'mark-'+controls.length,height:m.height,path:[p]});
  }
  return controls;
}

export function autoHeightSurfaces(map:Analysis,labels:Int16Array,marks:HeightMark[],slopes:boolean) {
  const {ids,levels}=slopes ? slopeRegions(map,labels,marks) : {ids:labels,levels:new Map<number,number[]>()};
  // Restoring a failed candidate in the raster keeps both sides of every shared
  // corner identical when the final polygons are traced.
  for (;;) {
    let restored=false;
    const patches=heightPolygons(ids,map.width).map(p=>{
      const heights=levels.get(p.height);
      if (!heights) return {...p,gradient:undefined};
      const gradient=slopeControls(p.polygon,p.height,heights,marks,ids,labels,map.width);
      if (new Set(gradient.map(c=>c.height)).size>=2) return {...p,height:heights[0],gradient};
      const xs=p.polygon[0].map(v=>v[0]), ys=p.polygon[0].map(v=>v[1]);
      const x0=Math.floor(Math.min(...xs)), x1=Math.ceil(Math.max(...xs));
      const y0=Math.floor(Math.min(...ys)), y1=Math.ceil(Math.max(...ys));
      for (let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
        const i=y*map.width+x;
        if (ids[i]===p.height && inRegion(p.polygon,{x:x+.5,y:y+.5})) { ids[i]=labels[i]; restored=true; }
      }
      return {...p,height:heights[0],gradient:undefined};
    });
    if (!restored) return patches;
  }
}
