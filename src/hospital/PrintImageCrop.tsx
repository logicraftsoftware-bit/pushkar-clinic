import {useEffect,useRef,useState,type PointerEvent} from "react";
import {cropPixels,type CropRect} from "./print-image";

export default function PrintImageCrop({source,onApply,onClose,printHint}:{source:string;printHint?:string;onApply:(image:string)=>void;onClose:()=>void}){
  const image=useRef<HTMLImageElement>(null),start=useRef<{x:number;y:number}|null>(null);
  const [crop,setCrop]=useState<CropRect>({x:0,y:0,width:100,height:100}),[ready,setReady]=useState(false),[error,setError]=useState("");
  function point(event:PointerEvent<HTMLDivElement>){const box=event.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(100,(event.clientX-box.left)/box.width*100)),y:Math.max(0,Math.min(100,(event.clientY-box.top)/box.height*100))};}
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")onClose();};window.addEventListener("keydown",escape);return()=>window.removeEventListener("keydown",escape);},[onClose]);
  function move(event:PointerEvent<HTMLDivElement>){if(!start.current)return;const p=point(event);setCrop({x:Math.min(99,p.x,start.current.x),y:Math.min(99,p.y,start.current.y),width:Math.max(1,Math.abs(p.x-start.current.x)),height:Math.max(1,Math.abs(p.y-start.current.y))});}
  function apply(){try{
    const original=image.current;if(!original||!ready)return;
    const area=cropPixels(crop,original.naturalWidth,original.naturalHeight),canvas=document.createElement("canvas");
    let scale=Math.min(1,2480/area.width,1200/area.height),result="";
    for(let attempt=0;attempt<6;attempt++){
      canvas.width=Math.max(1,Math.round(area.width*scale));canvas.height=Math.max(1,Math.round(area.height*scale));
      const context=canvas.getContext("2d");if(!context)throw new Error("Image cropping is unavailable in this browser");
      context.drawImage(original,area.x,area.y,area.width,area.height,0,0,canvas.width,canvas.height);result=canvas.toDataURL("image/png");
      if(result.length<=2_000_000){onApply(result);return;}scale*=0.75;
    }
    throw new Error("Choose a smaller image");
  }catch(e){setError(e instanceof Error?e.message:"Unable to crop image");}}
  return <div className="hm-crop-back"><section className="hm-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="crop-title"><header><h2 id="crop-title">Crop print image</h2><button type="button" onClick={onClose} aria-label="Close image cropping">Close</button></header><p>Drag over the image to select the area to keep, or adjust the sliders.</p>{printHint&&<p className="hm-crop-print-hint">{printHint}</p>}
    <div className="hm-crop-preview" onPointerDown={event=>{if(!ready)return;start.current=point(event);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={move} onPointerUp={event=>{move(event);start.current=null;}} onPointerCancel={()=>{start.current=null;}}>
      <img ref={image} src={source} alt="Image to crop" draggable={false} onLoad={()=>setReady(true)} onError={()=>setError("This image could not be opened. Choose PNG, JPG or WEBP.")}/><div className="hm-crop-selection" style={{left:`${crop.x}%`,top:`${crop.y}%`,width:`${Math.min(crop.width,100-crop.x)}%`,height:`${Math.min(crop.height,100-crop.y)}%`}}/>
    </div>
    <div className="hm-crop-controls">{(["x","y","width","height"] as const).map(key=><label key={key}>{({x:"Left",y:"Top",width:"Width",height:"Height"})[key]}: {Math.round(crop[key])}%<input type="range" min={key==="x"||key==="y"?0:1} max={key==="x"||key==="y"?99:key==="width"?100-crop.x:100-crop.y} value={crop[key]} onChange={e=>setCrop(previous=>{const next={...previous,[key]:Number(e.target.value)};next.width=Math.min(next.width,100-next.x);next.height=Math.min(next.height,100-next.y);return next;})}/></label>)}</div>
    {error&&<p className="hm-error" role="alert">{error}</p>}<footer><button type="button" onClick={()=>setCrop({x:0,y:0,width:100,height:100})}>Reset crop</button><button type="button" onClick={onClose}>Cancel</button><button type="button" disabled={!ready} onClick={apply}>Use cropped image</button></footer>
  </section></div>;
}
