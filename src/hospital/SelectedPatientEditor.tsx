import {useEffect,useState,type FormEvent} from 'react';
import {Edit3} from 'lucide-react';
import {PatientForm} from './Patients';
import {useLiveAccess} from './LiveAccess';
import './selected-patient-editor.css';
type Row=Record<string,any>;
const API=import.meta.env.VITE_API_URL??'';
export function PatientEditButton({onClick,disabled=false}:{onClick:()=>void;disabled?:boolean}){
  const {permissions}=useLiveAccess();
  if(permissions!==null&&!permissions.has('patient.update'))return null;
  return <button className="selected-patient-edit-button" type="button" data-permission="patient.update" disabled={disabled} onClick={onClick}><Edit3 size={15}/> Edit Patient</button>;
}
export default function SelectedPatientEditor({patientId,token,branches=[],onClose,onSaved}:{patientId:string;token:string;branches?:Row[];onClose:()=>void;onSaved:(patient:Row)=>void}){
  const [patient,setPatient]=useState<Row|null>(null),[fees,setFees]=useState<Row>({}),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const {permissions}=useLiveAccess();
  const canEdit=permissions===null||permissions.has('patient.update');
  async function request(path:string,options:RequestInit={}){
    const response=await fetch(`${API}/api/v1/patients${path}`,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to update patient');return data;
  }
  useEffect(()=>{
    const controller=new AbortController();
    void Promise.all([request(`/${patientId}`,{signal:controller.signal}),request('/registration-settings',{signal:controller.signal})]).then(([details,settings])=>{if(!controller.signal.aborted){setPatient(details.patient);setFees(settings);}}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[patientId,token]);
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!patient||saving||!canEdit)return;
    const fields:Row=Object.fromEntries(new FormData(event.currentTarget));
    for(const key of Object.keys(fields))if(typeof fields[key]==='string')fields[key]=fields[key].trim();
    const body={...fields,address:{title:fields.title,line:fields.address,city:fields.city,state:fields.state,pin:fields.pin,age_years:fields.age_years,age_months:fields.age_months,age_days:fields.age_days},emergency_contact:{name:fields.emergency_name,phone:fields.emergency_phone,relationship:fields.emergency_relationship}};
    setSaving(true);setError('');
    try{const updated=await request(`/${patientId}/details`,{method:'PUT',body:JSON.stringify(body)});onSaved({...updated,name:[updated.first_name,updated.last_name].filter(Boolean).join(' ').toUpperCase(),patient_name:[updated.first_name,updated.last_name].filter(Boolean).join(' ')});}catch(e){setError(e instanceof Error?e.message:'Unable to save patient');}finally{setSaving(false);}
  }
  if(!canEdit)return <section role="alert"><p>Your role does not allow patient editing.</p><button type="button" onClick={onClose}>Back</button></section>;
  if(!patient)return <section aria-busy={!error}>{error?<p role="alert">{error}</p>:<p role="status">Loading patient details…</p>}<button type="button" onClick={onClose}>Back</button></section>;
  const choices=branches.some(branch=>branch.id===patient.branch_id)?branches:[...branches,{id:patient.branch_id,name:patient.branch_name||'Current branch'}];
  return <PatientForm key={patient.id} patient={patient} branches={choices} fees={fees} page detailsOnly error={error} saving={saving} saveLabel="Save & Return" save={save} close={()=>{if(!saving)onClose();}}/>;
}
