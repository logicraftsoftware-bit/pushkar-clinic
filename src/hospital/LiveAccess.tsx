import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
type Access={ready:boolean;permissions:Set<string>|null;roles:Array<{id:string;name:string;is_system:boolean}>;managedRoles:Array<{id:string;name:string;is_system:boolean}>;error:string};
const Context=createContext<Access>({ready:true,permissions:null,roles:[],managedRoles:[],error:''});
export const useLiveAccess=()=>useContext(Context);
export function LiveAccessProvider({token,children}:{token?:string;children:ReactNode}){
  const [access,setAccess]=useState<Access>({ready:!token,permissions:token?new Set():null,roles:[],managedRoles:[],error:''});
  useEffect(()=>{
    if(!token)return;
    const controller=new AbortController(),base=import.meta.env.VITE_API_URL??(import.meta.env.PROD?'':'http://localhost:4000');
    const accessChannel=typeof BroadcastChannel==='undefined'?null:new BroadcastChannel('careframe-access-refresh-v1');
    let pending=false,again=false,stopped=false;
    const refresh=async()=>{
      if(pending){again=true;return;}pending=true;
      try{
        const response=await fetch(`${base}/api/v1/access-control/me`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
        const data=await response.json();
        if(!response.ok){if(data.code==='PASSWORD_CHANGE_REQUIRED')window.dispatchEvent(new Event('password-change-required'));if(response.status===401)window.dispatchEvent(new CustomEvent('session-invalid',{detail:data.error}));throw Error(data.error||'Unable to check your current access.');}
        if(!stopped)setAccess(old=>{const codes=[...data.permissions].sort(),names=data.roles??[],managedRoles=data.managed_roles??[];if(old.ready&&[...old.permissions??[]].sort().join('|')===codes.join('|')&&JSON.stringify(old.roles)===JSON.stringify(names)&&JSON.stringify(old.managedRoles)===JSON.stringify(managedRoles)&&!old.error)return old;return{ready:true,permissions:new Set(codes),roles:names,managedRoles,error:''};});
      }catch(error){if(!stopped)setAccess(old=>({...old,error:error instanceof Error?error.message:'Unable to check access.'}));}
      finally{pending=false;if(again&&!stopped){again=false;void refresh();}}
    };
    const notify=()=>{void refresh();accessChannel?.postMessage('refresh');};
    const peerRefresh=(event:MessageEvent)=>{if(event.data==='refresh')void refresh();};
    accessChannel?.addEventListener('message',peerRefresh);
    const stream=async()=>{
      while(!stopped){
        try{
          const response=await fetch(`${base}/api/v1/session/events`,{headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
          if(!response.ok||!response.body)throw Error('Access stream unavailable');
          const reader=response.body.getReader();let buffer='';const decoder=new TextDecoder();
          while(!stopped){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let end;while((end=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,end);buffer=buffer.slice(end+2);if(event.includes('data: refresh'))notify();}}
        }catch{if(stopped)break;}
        if(!stopped)await new Promise<void>(resolve=>{const finish=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',finish);resolve();};const timer=setTimeout(finish,3000);controller.signal.addEventListener('abort',finish,{once:true});});
      }
    };
    // One live stream per browser origin avoids exhausting HTTP/1 connection
    // slots when staff open many tabs. Every tab still checks its own access.
    void refresh();
    if(accessChannel&&navigator.locks){
      void navigator.locks.request('careframe-access-stream-v1',{signal:controller.signal},async()=>{if(!stopped)await stream();})
        .catch(()=>{if(!stopped)void stream();});
    }else void stream();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000);
    const focus=()=>{void refresh();};window.addEventListener('focus',focus);window.addEventListener('access-updated',focus);document.addEventListener('visibilitychange',focus);
    return()=>{stopped=true;controller.abort();accessChannel?.removeEventListener('message',peerRefresh);accessChannel?.close();clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('access-updated',focus);document.removeEventListener('visibilitychange',focus);};
  },[token]);
  useEffect(()=>{
    const guard=(event:Event)=>{
      const target=event.target as HTMLElement;
      const form=event.type==='click'?target?.closest('button[data-permission],a[data-permission],input[data-permission],select[data-permission]'):target?.closest('[data-permission]');const required=form?.getAttribute('data-permission');
      if(required&&access.permissions!==null&&!access.permissions.has(required)){event.preventDefault();event.stopPropagation();window.dispatchEvent(new CustomEvent('app-error',{detail:`Your role does not allow this action. Required permission: ${required}.`}));}
    };
    document.addEventListener('submit',guard,true);document.addEventListener('click',guard,true);return()=>{document.removeEventListener('submit',guard,true);document.removeEventListener('click',guard,true);};
  },[access.permissions]);
  const controlled=['patient.create','patient.update','patient.delete','appointment.create','appointment.update','appointment.cancel','ipd.create','ipd.update','billing.create','billing.update','billing.refund','inventory.manage','roles.manage','users.manage','documents.manage','lab.result.create'];
  const hidden=access.permissions===null?'':controlled.filter(code=>!access.permissions!.has(code)).map(code=>`button[data-permission="${code}"],[data-permission="${code}"] button[type="submit"]{display:none!important}`).join('');
  return <Context.Provider value={access}><style>{hidden}</style>{children}</Context.Provider>;
}
