import {useCallback,useEffect,useRef,useState} from 'react';
export type QueueRow=Record<string,any>;
export const API=import.meta.env.VITE_API_URL??(import.meta.env.PROD?'':'http://localhost:4000');
export async function queueRequest(path:string,token?:string,options:RequestInit={}){
  const response=await fetch(API+'/api/v1'+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...options.headers},cache:'no-store'});
  const data=response.status===204?null:await response.json();if(!response.ok)throw new Error(data?.error||'Unable to load the queue.');return data;
}
// Public SSE reconnects automatically. Polling keeps screens usable behind buffering proxies.
export function usePublicQueue(path:string){
  const [data,setData]=useState<QueueRow|null>(null),[error,setError]=useState(''),[connected,setConnected]=useState(false);
  useEffect(()=>{
    let current=true,busy=false;const controller=new AbortController();
    const accept=(value:QueueRow)=>{if(current){setData(value);setError('');setConnected(true);}};
    const poll=async()=>{if(busy)return;busy=true;try{accept(await queueRequest(path,undefined,{signal:controller.signal}));}catch(cause){if(current&&!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Live updates interrupted.');setConnected(false);}}finally{busy=false;}};
    void poll();let source:EventSource|undefined;
    if(typeof EventSource!=='undefined'){
      source=new EventSource(API+'/api/v1'+path+'/events');
      source.addEventListener('snapshot',event=>{try{accept(JSON.parse((event as MessageEvent).data));}catch{/* fallback poll */}});
      source.addEventListener('unavailable',event=>{if(current){setConnected(false);try{setError(JSON.parse((event as MessageEvent).data).error);}catch{setError('Reconnecting to the queue…');}}});
      source.onerror=()=>{if(current)setConnected(false);};
    }
    const timer=setInterval(poll,12000);return()=>{current=false;source?.close();controller.abort();clearInterval(timer);};
  },[path]);return {data,error,connected};
}
export function useStaffQueues(path:string,token:string){
  const [data,setData]=useState<QueueRow|null>(null),[error,setError]=useState('');const busy=useRef(false);
  const reload=useCallback(async()=>{if(busy.current)return;busy.current=true;try{setData(await queueRequest(path,token));setError('');}catch(cause){setError(cause instanceof Error?cause.message:'Queue unavailable.');}finally{busy.current=false;}},[path,token]);
  useEffect(()=>{let active=true;busy.current=false;setData(null);void reload();const timer=setInterval(()=>{if(active)void reload();},5000);return()=>{active=false;clearInterval(timer);};},[reload]);
  return {data,error,reload};
}
export const timeLabel=(value:unknown)=>value?new Date(String(value)).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}):'—';
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
