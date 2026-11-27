import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { TargetedPointerEvent } from 'preact';
import type { Board } from '../board/Board';
import type { GradientControl, Vec } from '../types';
import type { UiState } from '../state/ui';
import type { TableClient } from '../state/client';
import { useUi, useClient } from './common';

type Part = 'start' | 'end' | 'line';

/** Screen-space hit targets and inputs keep their size at every zoom level. */
export function GradientEditor({board,ui,client}: {board: Board; ui: UiState; client: TableClient}) {
  const state=useUi(ui);
  useClient(client);
  const id=state.gradientArea!;
  const [selected,setSelected]=useState<string|null>(null);
  const controls=board.gradientControls(id);
  const fields=useRef(new Map<string,HTMLInputElement>());
  const drag=useRef<{control:GradientControl; part:Part; from:Vec; screen:Vec; path?:Vec[]} | null>(null);
  const [preview,setPreview]=useState<{id:string;path:Vec[]} | null>(null);
  const frame=useRef(0);
  const pending=useRef<Vec|null>(null);
  const previewAt=(pointer:Vec)=>{
    const d=drag.current;
    if(!d || Math.hypot(pointer.x-d.screen.x,pointer.y-d.screen.y)<2) return;
    const current=d.part==='line' ? d.control.path : d.path ?? d.control.path;
    const path=board.dragGradientHandle(id,current,d.part,d.from,board.screenToWorld(pointer.x,pointer.y));
    if (path) { d.path=path; setPreview({id:d.control.id,path}); }
  };
  const cancelFrame=()=>{ cancelAnimationFrame(frame.current); frame.current=0; pending.current=null; };
  useLayoutEffect(()=>cancelFrame,[]);
  const focus=(key:string)=>{
    const input=fields.current.get(key);
    if(input) { setSelected(key); input.focus({preventScroll:true}); input.select(); }
    return !!input;
  };
  useLayoutEffect(()=>{
    if(state.gradientFocus && focus(state.gradientFocus)) ui.set({gradientFocus:undefined});
  },[state.gradientFocus,controls.length]);
  const update=(key:string,change:(c:GradientControl)=>GradientControl | null)=>{
    board.saveGradient(id,board.gradientControls(id).flatMap(c=>c.id===key ? change(c) ?? [] : [c]));
  };
  function handlers(c:GradientControl,part:Part) {
    return {
      onPointerDown(e:TargetedPointerEvent<Element>) {
        if(e.button!==0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current={control:c,part,from:board.screenToWorld(e.clientX,e.clientY),screen:{x:e.clientX,y:e.clientY}};
        focus(c.id);
      },
      onPointerMove(e:TargetedPointerEvent<Element>) {
        if(!drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        pending.current={x:e.clientX,y:e.clientY};
        if(!frame.current) frame.current=requestAnimationFrame(()=>{
          frame.current=0;
          if(pending.current) previewAt(pending.current);
          pending.current=null;
        });
      },
      onPointerUp(e:TargetedPointerEvent<Element>) {
        if(!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        cancelFrame();
        previewAt({x:e.clientX,y:e.clientY});
        const path=drag.current?.path;
        if(path) update(c.id,control=>({...control,path}));
        drag.current=null; setPreview(null);
      },
      onPointerCancel() { cancelFrame(); drag.current=null; setPreview(null); }
    };
  }
  const origin=board.worldToScreen({x:0,y:0}), zoom=board.zoomNow;
  return <div class="gradient-editor">
    {controls.map(c=>{
      const path=preview?.id===c.id ? preview.path : c.path;
      const screen=path.map(p=>({x:origin.x+p.x*zoom,y:origin.y+p.y*zoom}));
      const pos=(p:Vec)=>({left:p.x+'px',top:p.y+'px'});
      const points=screen.map(p=>p.x+','+p.y).join(' ');
      return <div key={c.id} class={selected===c.id ? 'gradient-selected' : undefined} onPointerDownCapture={()=>setSelected(c.id)} onFocusIn={()=>setSelected(c.id)}>
        {screen.length>1 && <svg class="gradient-line"><polyline points={points}/>
          <polyline class="gradient-hit" aria-label="Move height line" points={points} {...handlers(c,'line')}/></svg>}
        <button class="gradient-dot" aria-label="Move height point" style={pos(screen[0])}
          {...handlers(c,'start')} onClick={e=>{if(!e.detail) focus(c.id);}}/>
        {screen.length>1 && <button class="gradient-dot" aria-label="Move line end" style={pos(screen[screen.length-1])}
          {...handlers(c,'end')} onClick={e=>{if(!e.detail) focus(c.id);}}/>}
        <div class="gradient-box" style={pos(screen[0])} onKeyDown={e=>e.stopPropagation()}>
          <label><input ref={field=>{if(field) fields.current.set(c.id,field); else fields.current.delete(c.id);}}
            key={c.height} type="number" aria-label="Gradient height" min="-1000" max="5000" step="any"
            defaultValue={Math.round(c.height)} onKeyDown={e=>{if(e.key==='Enter') e.currentTarget.blur();}}
            onBlur={e=>{
              const field=e.currentTarget, value=field.valueAsNumber;
              if(field.value===field.defaultValue) return;
              if(Number.isFinite(value) && field.validity.valid && value!==c.height) update(c.id,control=>({...control,height:value,path:control.path.map(({x,y})=>({x,y}))}));
              field.value=String(Math.round(c.height));
            }}/> ft</label>
          <button aria-label="Delete height point" class="gradient-delete" onClick={()=>update(c.id,()=>null)}>×</button>
          <button class="gradient-convert" onClick={()=>{
            const next=c.path.length>1 ? [c.path[0]] : board.makeGradientLine(id,c.path[0]);
            if(next) update(c.id,control=>({...control,path:next}));
          }}>{c.path.length>1 ? 'To point' : 'To line'}</button>
        </div>
      </div>;
    })}
  </div>;
}
