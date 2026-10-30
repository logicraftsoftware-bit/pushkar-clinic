import {z} from 'zod';
// Penicillin-family reference: https://www.nhs.uk/medicines/amoxicillin/who-can-and-cannot-take-amoxicillin/
// Structural safeguards only; these do not replace a drug interaction database.
export function allergyConflicts(allergies:unknown,medicines:Array<Record<string,unknown>>){
 const text=(typeof allergies==='string'?allergies:JSON.stringify(allergies??'')).toLowerCase();
 if(!text.trim()||/^(none|nil|nka|nkda|no known allergies)$/i.test(text.trim()))return [];
 const penicillins=/\b(penicillin\w*|amoxicillin|amoxycillin|ampicillin|flucloxacillin|phenoxymethylpenicillin|benzylpenicillin|co[- ]?amoxiclav|augmentin)\b/i;
 return medicines.filter(m=>{const name=String(m.name||'').toLowerCase();
  if(penicillins.test(text)&&penicillins.test(name))return true;
  const words=name.match(/[a-z]{4,}/g)||[];return words.some(word=>new RegExp('\\b'+word+'\\b','i').test(text));
 }).map(m=>`Allergy conflict: ${m.name} conflicts with the patient's recorded allergies. Review the prescription before saving.`);
}
const medicine=z.object({name:z.string().trim().min(1,'Medicine name is required'),dose:z.string().trim().min(1,'Medicine dosage is required').refine(v=>!/(^|\s)-\d/.test(v)&&!/(?:9999|\d{5,})\s*(?:tablets?|capsules?)\b/i.test(v),'Enter a valid, plausible dosage'),quantity:z.union([z.string(),z.number()]).refine(v=>String(v).trim()!==''&&Number.isFinite(Number(v))&&Number.isInteger(Number(v))&&Number(v)>0&&Number(v)<=1000,'Medicine quantity must be a whole number from 1 to 1000')}).passthrough();
const test=z.object({name:z.string().trim().min(1,'Select a test before saving'),priority:z.enum(['Routine','Urgent','STAT','Stat','Normal','High']).optional()}).passthrough();
export const consultationData=z.object({medicines:z.array(medicine).optional(),lab_tests:z.array(test).optional(),radiology_tests:z.array(test).optional(),encounter_status:z.enum(['Draft','Completed']).optional()}).passthrough();

export function canonicalClinical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonicalClinical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+canonicalClinical(item)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
