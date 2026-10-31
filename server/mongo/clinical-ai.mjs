import {Router} from 'express';
import {z} from 'zod';
import {db} from './database.mjs';
import {config} from './config.mjs';
import {scopeFor,requirePermission,writeAudit} from './access.mjs';
import {completion} from './ai-provider.mjs';
const router=Router(),text=z.string().max(30000).prefault('');
const draft=z.object({symptoms:text,history:text,vitals:z.record(z.string().max(100),z.string().max(1000)).prefault({}),investigation:text,diagnosis:text,advice:text,follow_up:text,comment:text,medicines:z.array(z.object({name:z.string().max(200),type:text,dose:text,time:text,when:text,frequency:text,duration:text,quantity:z.union([z.string().max(20),z.number()]).prefault(''),instruction:text})).max(100).prefault([]),lab_tests:z.array(z.object({name:z.string().max(200),priority:z.enum(['Routine','Urgent','STAT']).prefault('Routine'),instruction:text})).max(100).prefault([])});
export async function aiLimit(response){
  const account=response.locals.account,window=Math.floor(Date.now()/900000),key=`${account.tenant_id}:${account.id}:${window}`;
  const counter=await db.collection('ai_limits').findOneAndUpdate({_id:key},{$inc:{requests:1},$setOnInsert:{expires_at:new Date((window+1)*900000)}},{upsert:true,returnDocument:'after'});
  if(counter.requests>30)throw Object.assign(new Error('AI request limit reached. Try again later.'),{status:429});
}
router.post('/soap',requirePermission('opd.create'),async(request,response)=>{
  const body=z.object({appointment_id:z.string().uuid().optional(),admission_id:z.string().uuid().optional(),transcript:z.string().trim().min(10).max(30000)}).refine(body=>Boolean(body.appointment_id)!==Boolean(body.admission_id)).parse(request.body),account=response.locals.account,admission=Boolean(body.admission_id);
  const encounter=await db.collection(admission?'ipd_admissions':'clinical_appointments').findOne(await scopeFor(response,{id:body.admission_id??body.appointment_id,...(account.role==='hospital_admin'?{}:{[admission?'consultant_doctor_id':'doctor_id']:account.id}),...(admission?{active:true}:{status:{$nin:['Cancelled','No Show']}})}));
  if(!encounter)return response.status(404).json({error:'Clinical encounter not found in your assignments.'});
  await aiLimit(response);
  const system='Translate the supplied clinical conversation into clear English SOAP documentation. Extract only explicitly spoken facts. Never invent findings, diagnoses, drugs, dosages, investigations or plans. Preserve negations. Return ONLY JSON with string keys symptoms,history,investigation,diagnosis,advice,follow_up,comment; vitals is an object of string values; medicines is an array of {type,name,dose,time,when,frequency,duration,quantity,instruction}; lab_tests is an array of {name,priority,instruction}, priority Routine/Urgent/STAT. Use empty strings or arrays for missing facts. This is an editable draft for clinician review; do not issue new treatment advice.';
  const raw=await completion({key:config.GROQ_API_KEY,model:config.GROQ_MODEL,json:true,tokens:2500,messages:[{role:'system',content:system},{role:'user',content:body.transcript}]});
  const result=draft.safeParse(raw);if(!result.success)throw Object.assign(new Error('AI returned an invalid clinical draft. Try again.'),{status:502});
  await writeAudit(response,'clinical_ai_draft_generated',encounter.id,undefined,{type:'soap'});response.json({soap:result.data});
});
router.post('/handwriting',requirePermission('opd.create'),async(request,response)=>{
  const body=z.object({image:z.string().max(7500000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),section:z.string().trim().min(1).max(100)}).parse(request.body);await aiLimit(response);
  const text=await completion({key:config.GROQ_API_KEY,model:config.GROQ_VISION_MODEL,tokens:1200,messages:[{role:'user',content:[{type:'text',text:`Transcribe only the visible handwriting in this ${body.section} clinical note. Preserve words, units, numbers and negations. Mark unreadable text [?]. Add no advice or interpretation. Return only plain transcription.`},{type:'image_url',image_url:{url:body.image}}]}]});
  await writeAudit(response,'clinical_ai_draft_generated',null,undefined,{type:'handwriting'});response.json({text});
});
export default router;
