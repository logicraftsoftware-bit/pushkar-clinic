import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {X} from 'lucide-react';
import './digital-signature-field.css';

export default function DigitalSignatureField({value='',required=false}:{value?:string;required?:boolean}){
  const id=useId(),[preview,setPreview]=useState(value),[file,setFile]=useState<File|null>(null),[open,setOpen]=useState(false);
  const closeButton=useRef<HTMLButtonElement>(null);
  useEffect(()=>{setFile(null);setPreview(value);setOpen(false);},[value]);
  useEffect(()=>{
    if(!file)return;
    const url=URL.createObjectURL(file);setPreview(url);
    return()=>URL.revokeObjectURL(url);
  },[file]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    closeButton.current?.focus();
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpen(false);}
      if(event.key==='Tab'){event.preventDefault();closeButton.current?.focus();}
    };
    document.addEventListener('keydown',key,true);
    return()=>{document.removeEventListener('keydown',key,true);previous?.focus();};
  },[open]);
  return <div className="staff-signature-field">
    <label htmlFor={id}>Digital Signature{required?' *':''}</label>
    <div className="staff-signature-upload">
      <input id={id} name="digital_signature" type="file" accept="image/*" required={required&&!value} onChange={event=>{
        const next=event.target.files?.[0]||null;setFile(next);if(!next)setPreview(value);
      }}/>
      {preview&&<button type="button" className="staff-signature-thumbnail" aria-label="Enlarge digital signature" onClick={()=>setOpen(true)}>
        <img src={preview} alt="Uploaded digital signature"/>
      </button>}
    </div>
    {open&&preview&&createPortal(<div className="staff-signature-backdrop" onClick={()=>setOpen(false)}>
      <section className="staff-signature-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-heading`} onClick={event=>event.stopPropagation()}>
        <header><h2 id={`${id}-heading`}>Digital Signature</h2><button type="button" ref={closeButton} aria-label="Close signature preview" onClick={()=>setOpen(false)}><X size={22}/></button></header>
        <img src={preview} alt="Enlarged digital signature"/>
      </section>
    </div>,document.body)}
  </div>;
}
