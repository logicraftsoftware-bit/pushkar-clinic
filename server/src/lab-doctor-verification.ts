type Row=Record<string,any>;
export function verificationPathologists(actor:Row,requested:string[],profiles:Row[]){
  const ids=["Pathologist","Radiologist"].includes(actor.staff_type)?[actor.staff_id]:[...new Set(requested)];
  if(!ids.length||ids.some(id=>!id))throw new Error("Select at least one report pathologist");
  return ids.map(id=>{const profile=profiles.find(row=>row.id===id);if(!profile)throw new Error("Select pathologists from this hospital");if(!profile.professional?.digital_signature)throw new Error(`Upload the digital signature for ${profile.name} in Staff Management first`);return profile;});
}
