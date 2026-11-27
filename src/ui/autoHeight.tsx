import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import clip, { type Pair, type Polygon } from 'polygon-clipping';
import type { Board } from '../board/Board';
import { analyzeHeightMap, draftHeights, heightPolygons, type HeightMark } from '../core/autoHeight';
import { heightColor, newAreaId, terrainOf, surfaceHeight } from '../core/terrain';
import { inRegion, patchStroke, terrainLayers } from '../core/terrainEdges';
import { regionContacts, regionControls } from '../core/autoSlopes';
import type { GradientControl } from '../types';
import type { TableClient } from '../state/client';
import { Modal, toast, useClient } from './common';

// Sample the same surface used by walking tokens. SVG clips the colour preview
// to the exact saved polygon, including its holes and any existing paint.
function slopePreview(polygon:Polygon, gradient:GradientControl[], pixel:number) {
  const xs=polygon[0].map(p=>p[0]), ys=polygon[0].map(p=>p[1]);
  const x=Math.min(...xs), y=Math.min(...ys), width=Math.max(...xs)-x, height=Math.max(...ys)-y;
  const c=document.createElement('canvas');
  c.width=Math.min(96,Math.max(2,Math.ceil(width/pixel)));
  c.height=Math.min(96,Math.max(2,Math.ceil(height/pixel)));
  const ctx=c.getContext('2d')!, img=ctx.createImageData(c.width,c.height);
  const colors=new Map<number,number>(), area={h:gradient[0].height,gradient};
  for (let row=0;row<c.height;row++) for (let col=0;col<c.width;col++) {
    const h=Math.round(surfaceHeight(area,{x:x+(col+.5)*width/c.width,y:y+(row+.5)*height/c.height})*4)/4;
    const color=colors.get(h) ?? parseInt(heightColor(h).slice(1),16);
    colors.set(h,color);
    const i=4*(row*c.width+col);
    img.data[i]=color>>16; img.data[i+1]=(color>>8)&255; img.data[i+2]=color&255; img.data[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  return {x,y,width,height,href:c.toDataURL()};
}

export function AutoHeightModal({ client, board, onClose }: { client: TableClient; board: Board | null; onClose: () => void }) {
  useClient(client);
  const scene = client.scene, meta = scene?.meta;
  const source = JSON.stringify([scene?.id,meta?.mapUrl,meta?.mapX,meta?.mapY,meta?.mapScale,meta?.mapW,meta?.mapH]);
  const original = useRef(source).current;
  const [loaded, setLoaded] = useState<{ map: ReturnType<typeof analyzeHeightMap>; image: string } | null>(null);
  const [history, setHistory] = useState<HeightMark[][]>([[]]);
  const marks = history[history.length-1];
  const [editing,setEditing]=useState(false);
  const [selected,setSelected]=useState('');
  const [gradients,setGradients]=useState(new Set<string>());
  const [smooth,setSmooth]=useState(new Set<string>());
  const toggle=(current:Set<string>,key:string)=>{
    const next=new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };
  const [height, setHeight] = useState('10');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const locked = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState({x:0,y:0,zoom:1});
  const drag = useRef<{x:number;y:number;viewX:number;viewY:number;scale:number} | null>(null);
  const panned = useRef(false);

  useEffect(() => {
    if (source !== original) { onClose(); return; }
    let alive = true;
    async function load() {
      if (!board) throw new Error('The board is still loading.');
      const r = await board.readMapForWalls(1100);
      if (!alive) return;
      if ('error' in r) throw new Error(r.error);
      const c = document.createElement('canvas');
      c.width = r.img.width; c.height = r.img.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.img.data),c.width,c.height),0,0);
      setLoaded({ map: analyzeHeightMap(r.img), image: c.toDataURL() });
    }
    void load().catch(e => { if (alive) setError(String(e.message || e)); });
    return () => { alive = false; };
  }, [board,source]);

  // Work in scene coordinates for both the preview and the final cut around existing paint.
  const width = (meta?.mapW ?? 0)*(meta?.mapScale ?? 1), heightPx = (meta?.mapH ?? 0)*(meta?.mapScale ?? 1);
  const left = meta?.mapX ?? 0, top = meta?.mapY ?? 0;
  const limit = (position: number, zoom: number) => Math.max(0,Math.min(1-1/zoom,position));
  const zoomAt = (zoom: number, x = view.x+.5/view.zoom, y = view.y+.5/view.zoom) => {
    zoom = Math.max(1,Math.min(8,zoom));
    const ratio = view.zoom/zoom;
    setView({zoom,x:limit(x+(view.x-x)*ratio,zoom),y:limit(y+(view.y-y)*ratio,zoom)});
  };
  const terrain=useMemo(()=>terrainOf(scene?.draws.values() ?? [],client.grid),[scene,scene?.drawRev,client.grid]);
  const existing=useMemo(()=>{
    const shapes=terrainLayers(terrain).map(layer=>layer.shape);
    return shapes.length ? clip.union(shapes[0],...shapes.slice(1)) : [];
  },[terrain]);
  const regions=useMemo(()=>{
    if (!loaded || !marks.length) return [];
    const m=loaded.map;
    return heightPolygons(draftHeights(m,marks),m.width).flatMap(p=>{
      const world=p.polygon.map(r=>r.map(([x,y]):Pair=>[left+x*width/m.width,top+y*heightPx/m.height]));
      return (existing.length ? clip.difference(world,existing) : [world]).map(polygon=>({
        height:p.height,polygon,path:polygon.map(r=>'M'+r.map(v=>v.join(',')).join('L')+'Z').join('')
      }));
    });
  },[loaded,marks,existing,left,top,width,heightPx]);
  const contacts=useMemo(()=>regionContacts(regions,terrain),[regions,terrain]);
  const active=regions.findIndex(p=>p.path===selected);
  const edges=editing && active>=0 && gradients.has(selected) ? contacts(active) : [];
  const patches=useMemo(()=>{
    const m=loaded?.map;
    const pins=m ? marks.map(p=>({height:p.height,x:left+(p.x+.5)*width/m.width,y:top+(p.y+.5)*heightPx/m.height})) : [];
    const enabled=new Set(regions.flatMap((p,i)=>gradients.has(p.path) ? [i] : []));
    return regions.map((p,i)=>{
      const pixel=width/(m?.width || 1);
      const gradient=enabled.has(i) ? regionControls(p,contacts(i),smooth,enabled,pins,terrain,pixel) : undefined;
      const preview=gradient && gradient.some(c=>c.height!==p.height || c.path.some(v=>v.rise)) ? slopePreview(p.polygon,gradient,pixel) : undefined;
      return {...p,gradient,preview};
    });
  },[regions,contacts,gradients,smooth,loaded,marks,terrain,left,top,width,heightPx]);
  const slopeCount=patches.filter(p=>p.gradient).length;
  const value = Number(height);
  const valid = height.trim() !== '' && Number.isInteger(value) && value >= -1000 && value <= 5000;

  const mark = (e: MouseEvent) => {
    if (panned.current) return;
    const transform = svg.current?.getScreenCTM();
    if (!loaded || !transform || locked.current) return;
    const p = new DOMPoint(e.clientX,e.clientY).matrixTransform(transform.inverse());
    if (editing) {
      const edge=(e.target as Element).closest('[data-contact]')?.getAttribute('data-contact');
      if (edge) setSmooth(toggle(smooth,edge));
      else setSelected(regions.find(r=>inRegion(r.polygon,p))?.path ?? '');
      return;
    }
    if (!valid) return;
    const m = loaded.map, x = Math.floor((p.x-left)*m.width/width), y = Math.floor((p.y-top)*m.height/heightPx);
    if (x<0 || x>=m.width || y<0 || y>=m.height || !m.opaque[y*m.width+x]) return;
    const hit = (e.target as Element).closest('[data-mark]')?.getAttribute('data-mark');
    const index = hit != null ? Number(hit) : marks.findIndex(a => a.x===x && a.y===y);
    if (index >= 0 && e.shiftKey) { setHistory([...history,marks.filter((_,i) => i!==index)]); return; }
    const next = index < 0 ? [...marks,{x,y,height:value}] : marks.map((a,i) => i===index ? {...a,height:value} : a);
    setHistory([...history,next]);
  };
  const apply = async () => {
    if (locked.current || !patches.length || source !== original) return;
    locked.current = true; setSaving(true);
    try {
      await client.addDrawings(patches.map(p => ({...patchStroke(p.polygon,newAreaId(),p.height),
        ...(p.gradient && {gradient:p.gradient,gradientEnabled:true,gradientFixed:true})})), 'Auto height map');
      toast('Height map applied. Ctrl+Z undoes it.', 'ok'); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { locked.current = false; setSaving(false); }
  };
  const unit = Math.max(width,heightPx)/(65*view.zoom);
  return <Modal title="Auto height map" width={900} onClose={() => { if (!locked.current) onClose(); }}
    footer={<><span class="muted grow" role="status">{saving ? 'Applying…' : !loaded ? (error ? '' : 'Reading map…') :
      patches.length ? patches.length+' editable '+(patches.length===1 ? 'area' : 'areas')+(slopeCount ? ' · '+slopeCount+(slopeCount===1 ? ' slope' : ' slopes') : '') : marks.length ? 'No unpainted terrain in this area.' : ''}</span>
      <button class="btn" disabled={saving} onClick={onClose}>Cancel</button>
      <button class="btn primary" disabled={!patches.length || saving} onClick={apply}>Apply heights</button></>}>
    {error && <p role="alert">{error}</p>}
    {loaded && <>
      <div class="row wrap">
        <button class={'btn small'+(!editing ? ' primary' : '')} aria-pressed={!editing} onClick={()=>setEditing(false)}>Mark heights</button>
        <button class={'btn small'+(editing ? ' primary' : '')} aria-pressed={editing} disabled={!regions.length} onClick={()=>setEditing(true)}>Edit regions</button>
      </div>
      {editing ? <>
        <p class="hint">{active<0 ? 'Click a region to select it.' : gradients.has(selected) ? 'Click an edge to switch between wall (dashed gold) and smooth (solid teal).' : 'Turn this region into a gradient to choose which edges meet their neighbors.'}</p>
        {active>=0 && <label><input type="checkbox" checked={gradients.has(selected)} onChange={()=>setGradients(toggle(gradients,selected))}/> Gradient · {regions[active].height} ft</label>}
      </> : <><p class="hint">Choose a height and click a terrace, bank, or patch of ground. Add a mark on the other side of a misplaced boundary to guide it.</p>
      <div class="row wrap">
        <label class="numf"><span>Height</span><input aria-label="Height in feet" type="number" min="-1000" max="5000" step="1" value={height} onInput={e => setHeight(e.currentTarget.value)} /><span>ft</span></label>
        {[-10,-5,0,5,10,15,20,30,40].map(h => <button key={h} class={'btn small'+(valid && value===h ? ' primary' : '')} onClick={() => setHeight(String(h))}>{h}</button>)}
      </div></>}
      <svg style={{cursor:editing ? 'pointer' : 'crosshair'}} ref={svg} class="auto-height-map" viewBox={[left+view.x*width,top+view.y*heightPx,width/view.zoom,heightPx/view.zoom].join(' ')}
        aria-label="Map height preview" onClick={mark}
        onPointerDown={e => {
          panned.current=false;
          const scale=svg.current?.getScreenCTM()?.a;
          if (scale && view.zoom>1) drag.current={x:e.clientX,y:e.clientY,viewX:view.x,viewY:view.y,scale};
        }}
        onPointerMove={e => {
          const d=drag.current;
          if (!d || !e.buttons) return;
          const dx=e.clientX-d.x, dy=e.clientY-d.y;
          if (Math.hypot(dx,dy)<4 && !panned.current) return;
          panned.current=true; e.currentTarget.setPointerCapture(e.pointerId);
          setView({...view,x:limit(d.viewX-dx/(d.scale*width),view.zoom),y:limit(d.viewY-dy/(d.scale*heightPx),view.zoom)});
        }}
        onPointerUp={() => { drag.current=null; }} onPointerCancel={() => { drag.current=null; }}
        onWheel={e => {
          const transform=svg.current?.getScreenCTM();
          if (!transform) return;
          e.preventDefault();
          const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(transform.inverse());
          zoomAt(view.zoom*(e.deltaY<0 ? 1.3 : 1/1.3),(p.x-left)/width,(p.y-top)/heightPx);
        }}>
        <image href={loaded.image} x={left} y={top} width={width} height={heightPx} preserveAspectRatio="none"/>
        {patches.map((p,i) => <g key={i}>
          {p.preview && <><clipPath id={'auto-slope-'+i}><path d={p.path} clip-rule="evenodd"/></clipPath>
            <image {...p.preview} opacity=".52" preserveAspectRatio="none" clip-path={'url(#auto-slope-'+i+')'}/></>}
          <path d={p.path} fill={p.preview ? 'none' : heightColor(p.height)} fill-opacity=".52" fill-rule="evenodd"
            stroke={editing && i===active ? '#ff69b4' : '#ffe1a2'} stroke-width={editing && i===active ? 3 : .75} vector-effect="non-scaling-stroke"/>
        </g>)}
        {edges.map(edge=>{
          const matched=smooth.has(edge.key);
          const d=edge.path.map((v,i)=>(i?'L':'M')+v.x+','+v.y).join('');
          return <g key={edge.key} data-contact={edge.key} data-smooth={String(matched)}>
            <title>{matched ? 'Smooth' : 'Wall'} · {edge.height} ft adjoining terrain</title>
            <path d={d} fill="none" stroke={matched ? '#00f2cc' : '#ffcb6b'} stroke-width="3" stroke-dasharray={matched ? undefined : '6 4'} vector-effect="non-scaling-stroke"/>
            <path d={d} fill="none" stroke="transparent" stroke-width="14" vector-effect="non-scaling-stroke" pointer-events="stroke"/>
          </g>;
        })}
        {!editing && marks.map((a,i) => <g key={i} data-mark={i} transform={`translate(${left+(a.x+0.5)*width/loaded.map.width} ${top+(a.y+0.5)*heightPx/loaded.map.height})`}>
          <circle r={unit*.50} fill={heightColor(a.height)} stroke="white" stroke-width={unit*.16}/>
          <text x={unit*.65} y={unit*.45} font-size={unit*1.65} fill="white" stroke="#14171e" stroke-width={unit*.45} paint-order="stroke" font-weight="700">{a.height}</text>
        </g>)}
      </svg>
      <div class="row wrap">
        {!editing && <button class="btn small" disabled={!marks.length || saving} onClick={() => setHistory(history.slice(0,-1))}>Undo mark</button>}
        <button class="btn small" disabled={view.zoom>=8} onClick={() => zoomAt(view.zoom*2)}>Zoom in</button>
        {view.zoom>1 && <button class="btn small" onClick={() => zoomAt(1)}>Fit map</button>}</div>
      <p class="hint">One height marks matching patches and fills the rest at 0 ft. Different heights divide the whole map. Existing terrain is preserved. Shift-click a mark to remove it.</p>
    </>}
  </Modal>;
}
