import {useState} from 'react';
import {ChevronLeft,MessageCircle,X} from 'lucide-react';
import './hosai-launcher.css';
export default function HosAiLauncher({userKey,onOpen}:{userKey:string;onOpen:()=>void}){
  const key=`careframe_hosai_collapsed:${userKey}`;
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem(key)==='true';}catch{return false;}});
  const change=(value:boolean)=>{setCollapsed(value);try{localStorage.setItem(key,String(value));}catch{/* The control still works when browser storage is unavailable. */}};
  if(collapsed)return <button className="hosai-expand" aria-label="Expand HosAI button" title="Expand HosAI" onClick={()=>change(false)}><ChevronLeft size={19}/></button>;
  return <div className="hosai-launcher"><button className="hosai-open" onClick={onOpen} aria-label="Open HosAI" title="HosAI"><MessageCircle size={25}/><span>HosAI</span></button><button className="hosai-close" onClick={()=>change(true)} aria-label="Minimize HosAI button" title="Minimize HosAI"><X size={14}/></button></div>;
}
