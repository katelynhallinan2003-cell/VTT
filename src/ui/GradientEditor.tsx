import { useState } from 'preact/hooks';
import type { Board } from '../board/Board';
import type { GradientControl, Vec } from '../types';
import type { UiState } from '../state/ui';
import type { TableClient } from '../state/client';
import { useUi, useClient } from './common';

/** The handles live in screen space so their inputs remain usable at any map zoom. */
export function GradientEditor({board,ui,client}: {board: Board; ui: UiState; client: TableClient}) {
  const state = useUi(ui);
  useClient(client);
  const id = state.gradientArea!;
  const controls = board.gradientControls(id);
  const [preview,setPreview] = useState<{id:string;path:Vec[]} | null>(null);
  const update = (key:string, change:(c:GradientControl)=>GradientControl | null) => {
    const next = board.gradientControls(id).flatMap(c => c.id===key ? change(c) ?? [] : [c]);
    board.saveGradient(id,next);
  };
  return <div class="gradient-editor">
    {controls.map(c => {
      const path = preview?.id===c.id ? preview.path : c.path;
      const screen = path.map(p=>board.worldToScreen(p));
      const dot = (end:boolean) => {
        const pos=screen[end ? screen.length-1 : 0];
        const move = (x:number,y:number) => {
          const p=board.screenToWorld(x,y);
          if (c.path.length===1) return board.gradientPlacement(id,p);
          return end ? board.gradientPlacement(id,c.path[0],p) : board.gradientPlacement(id,p,c.path[c.path.length-1],false);
        };
        return <button class="gradient-dot" aria-label={end ? 'Move line end' : 'Move height point'}
          style={{left:pos.x+"px",top:pos.y+"px"}}
          onPointerDown={e=>{ if (e.button===0) e.currentTarget.setPointerCapture(e.pointerId); }}
          onPointerMove={e=>{
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const next=move(e.clientX,e.clientY);
            if (next) setPreview({id:c.id,path:next});
          }}
          onPointerCancel={()=>setPreview(null)}
          onPointerUp={e=>{
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const next=move(e.clientX,e.clientY) ?? preview?.path;
            if (next && preview) update(c.id,control=>({...control,path:next}));
            setPreview(null);
          }}/>;
      };
      return <div key={c.id}>
        {screen.length>1 && <svg class="gradient-line"><polyline points={screen.map(p=>p.x+','+p.y).join(' ')} /></svg>}
        {dot(false)}{screen.length>1 && dot(true)}
        <div class="gradient-box" style={{left:screen[0].x+"px",top:screen[0].y+"px"}} onKeyDown={e=>e.stopPropagation()}>
          <label><input key={c.height} type="number" aria-label="Gradient height" min="-1000" max="5000" step="any"
            defaultValue={c.height} onKeyDown={e=>{if(e.key==='Enter') e.currentTarget.blur();}}
            onBlur={e=>{
              const field=e.currentTarget, value=field.valueAsNumber;
              if (Number.isFinite(value) && field.validity.valid && value!==c.height) update(c.id,control=>({...control,height:value}));
              else field.value=String(c.height);
            }}/> ft</label>
          <button aria-label="Delete height point" class="gradient-delete" onClick={()=>{update(c.id,()=>null); if(state.gradientLine===c.id) ui.set({gradientLine:undefined});}}>×</button>
          <button class="gradient-convert" onClick={()=>{
            if (c.path.length>1) update(c.id,control=>({...control,path:[control.path[0]]}));
            else ui.set({gradientLine:state.gradientLine===c.id ? undefined : c.id});
          }}>{c.path.length>1 ? 'To point' : state.gradientLine===c.id ? 'Cancel line' : 'To line'}</button>
        </div>
      </div>;
    })}
  </div>;
}
