import {useState} from 'react';
import {Copy,Share2,Link2,ShieldCheck} from 'lucide-react';
import {queueRequest} from './useLiveQueue';
import './queue.css';
export default function AppointmentPassActions({appointment,token}:{appointment:Record<string,any>;token:string}){
  const [path,setPath]=useState(appointment.public_appointment_path||''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const url=path?window.location.origin+path:'';
  async function generate(){setBusy(true);setNotice('');try{const result=await queueRequest('/queue/passes/'+appointment.id,token,{method:'POST'});setPath(result.path);setNotice('New pass created. Previously shared links for this appointment no longer work.');}catch(error){setNotice((error as Error).message);}finally{setBusy(false);}}
  async function copy(){try{await navigator.clipboard.writeText(url);setNotice('Appointment link copied.');}catch{setNotice('Select and copy the link shown above.');}}
  async function share(){try{if(navigator.share)await navigator.share({title:'Your clinic appointment',url});else await copy();}catch{/* share cancelled */}}
  async function revoke(){setBusy(true);try{await queueRequest('/queue/passes/'+appointment.id,token,{method:'DELETE'});setPath('');setNotice('Appointment pass revoked.');}catch(error){setNotice((error as Error).message);}finally{setBusy(false);}}
  return <section className="appointment-pass-actions"><div><ShieldCheck/><strong>Digital appointment pass</strong></div><p>A private link for this appointment’s details, receipt and live queue.</p>{url?<><input aria-label="Patient appointment link" readOnly value={url} onFocus={event=>event.currentTarget.select()}/><div className="queue-actions"><button type="button" onClick={copy}><Copy size={16}/> Copy link</button><button type="button" onClick={share}><Share2 size={16}/> Share</button><a href={path} target="_blank" rel="noreferrer">Open patient view</a><button type="button" disabled={busy} onClick={revoke}>Revoke</button></div></>:<button type="button" disabled={busy} onClick={generate}><Link2 size={16}/>{busy?'Creating…':'Generate / replace private link'}</button>}{notice&&<p role="status">{notice}</p>}</section>;
}
