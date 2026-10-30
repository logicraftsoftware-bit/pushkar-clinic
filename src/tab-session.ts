export const PORTAL_SESSION_KEY='careframe_portal_session';
export const ADMIN_SESSION_KEY='careframe_superadmin_token';
export const TAB_SESSION_EVENT='tab-session-changed';
const keys=new Set([PORTAL_SESSION_KEY,ADMIN_SESSION_KEY]);
const hintKey=(key:string)=>`${key}_tab_hint`;
type Host={sessionStorage:Pick<Storage,'getItem'|'setItem'|'removeItem'>;location:Pick<Location,'href'>;history?:Pick<History,'replaceState'>;dispatchEvent?:(event:Event)=>boolean};
type Channel=Pick<BroadcastChannel,'postMessage'|'addEventListener'|'removeEventListener'|'close'>;

// Share a session only with a same-origin tab requesting its random hint.
// Credentials stay in tab storage and channel messages, never in link URLs.
export function createTabSessionBridge(host:Host,channel:Channel|null,random:()=>string=()=>crypto.randomUUID(),timeoutMs=3000){
  const origin=new URL(host.location.href).origin;
  const pending=new Map<string,{key:string;hint:string;resolve:(value:string|null)=>void;timer:ReturnType<typeof setTimeout>}>();
  const requestedHint=()=>new URL(host.location.href).searchParams.get('_session');
  function finishUrl(){
    const url=new URL(host.location.href);
    if(!url.searchParams.has('_session'))return;
    url.searchParams.delete('_session');host.history?.replaceState(null,'',url.href);
  }
  function hint(key:string){
    if(!keys.has(key)||!host.sessionStorage.getItem(key))return null;
    let value=host.sessionStorage.getItem(hintKey(key));
    if(!value){value=random();host.sessionStorage.setItem(hintKey(key),value);}
    return value;
  }
  function read(key:string){
    if(!keys.has(key))return null;
    const wanted=requestedHint();
    if(wanted&&host.sessionStorage.getItem(hintKey(key))!==wanted)return null;
    const value=host.sessionStorage.getItem(key);
    if(value){hint(key);if(wanted)finishUrl();}
    return value;
  }
  const post=(message:Record<string,unknown>)=>channel?.postMessage({...message,origin});
  const changed=(key:string)=>host.dispatchEvent?.(new CustomEvent(TAB_SESSION_EVENT,{detail:{key}}));
  const identity=(key:string,value:string|null)=>{
    if(key===ADMIN_SESSION_KEY||!value)return value;
    try{return JSON.parse(value).token;}catch{return value;}
  };
  function cancelPending(key:string){
    for(const [id,request] of pending){if(request.key===key){clearTimeout(request.timer);pending.delete(id);request.resolve(null);}}
  }
  function write(key:string,value:string){
    if(!keys.has(key))throw Error('Unknown session type');
    cancelPending(key);
    const current=host.sessionStorage.getItem(key);
    const sessionHint=identity(key,current)===identity(key,value)?hint(key)||random():random();
    host.sessionStorage.setItem(key,value);host.sessionStorage.setItem(hintKey(key),sessionHint);finishUrl();
    post({type:'update',key,hint:sessionHint,value});
  }
  function clear(key:string){
    if(!keys.has(key))return;
    cancelPending(key);
    const sessionHint=host.sessionStorage.getItem(hintKey(key));
    host.sessionStorage.removeItem(key);host.sessionStorage.removeItem(hintKey(key));
    if(sessionHint)post({type:'clear',key,hint:sessionHint});
    changed(key);
  }
  function receive(event:MessageEvent){
    const message=event.data;
    if(!message||message.origin!==origin||!keys.has(message.key)||typeof message.hint!=='string')return;
    if(message.type==='request'){
      if(hint(message.key)!==message.hint)return;
      const value=host.sessionStorage.getItem(message.key);
      if(value)post({type:'response',key:message.key,hint:message.hint,id:message.id,value});
    }else if(message.type==='response'){
      const request=pending.get(message.id);
      if(!request||request.key!==message.key||request.hint!==message.hint||typeof message.value!=='string')return;
      clearTimeout(request.timer);pending.delete(message.id);
      host.sessionStorage.setItem(message.key,message.value);host.sessionStorage.setItem(hintKey(message.key),message.hint);finishUrl();
      request.resolve(message.value);
    }else if(message.type==='update'){
      if(host.sessionStorage.getItem(hintKey(message.key))!==message.hint||typeof message.value!=='string')return;
      host.sessionStorage.setItem(message.key,message.value);changed(message.key);
    }else if(message.type==='clear'){
      for(const [id,request] of pending){if(request.key===message.key&&request.hint===message.hint){clearTimeout(request.timer);pending.delete(id);request.resolve(null);}}
      if(host.sessionStorage.getItem(hintKey(message.key))!==message.hint)return;
      host.sessionStorage.removeItem(message.key);host.sessionStorage.removeItem(hintKey(message.key));changed(message.key);
    }
  }
  channel?.addEventListener('message',receive);
  return {
    read,write,clear,
    restore(key:string):Promise<string|null>{
      const current=read(key),wanted=requestedHint();
      if(current||!wanted||!channel||!keys.has(key))return Promise.resolve(current);
      return new Promise(resolve=>{
        const id=random(),timer=setTimeout(()=>{pending.delete(id);resolve(null);},timeoutMs);
        pending.set(id,{key,hint:wanted,resolve,timer});post({type:'request',key,hint:wanted,id});
      });
    },
    href(path:string,key=PORTAL_SESSION_KEY){
      const url=new URL(path,origin);
      if(url.origin!==origin)throw Error('Workspace links must use the ERP origin');
      const sessionHint=hint(key);if(sessionHint)url.searchParams.set('_session',sessionHint);
      return `${url.pathname}${url.search}${url.hash}`;
    },
    close(){channel?.removeEventListener('message',receive);channel?.close();for(const request of pending.values()){clearTimeout(request.timer);request.resolve(null);}pending.clear();},
  };
}

let bridge:ReturnType<typeof createTabSessionBridge>|undefined;
export function initializeTabSessions(){
  return bridge??=createTabSessionBridge(window,typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('careframe-workspace-sessions-v1'));
}
export const readTabSession=(key:string)=>initializeTabSessions().read(key);
export const writeTabSession=(key:string,value:string)=>initializeTabSessions().write(key,value);
export const clearTabSession=(key:string)=>initializeTabSessions().clear(key);
export const restoreTabSession=(key:string)=>initializeTabSessions().restore(key);
export const workspaceHref=(path:string,key=PORTAL_SESSION_KEY)=>initializeTabSessions().href(path,key);
