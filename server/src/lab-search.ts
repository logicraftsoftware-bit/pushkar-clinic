export function labSearchPatterns(input:string):string[]{
  const search=input.trim();
  const digits=search.replace(/\D/g,"");
  const terms=/^[+\d\s().-]+$/.test(search)?[digits.length===12&&digits.startsWith("91")?digits.slice(2):digits]:search.split(/\s+/);
  return terms.filter(Boolean).map(term=>`%${term.replace(/[\\%_]/g,"\\$&")}%`);
}

// Search only useful identifiers and test names, never entire result/audit JSON.
export function labSearchSql(includeBill=false):string{
  return `($2='' OR concat_ws(' ',w.title,p.first_name,p.last_name,p.phone,p.medical_record_number,
    w.data->>'customer_name',w.data->>'phone',w.data->>'medical_record_number',w.status,
    w.data->>'legacy_opd_id',w.data->>'legacy_patient_id',w.data->>'bill_number',
    regexp_replace(coalesce(p.phone,''),'[^0-9]','','g'),regexp_replace(coalesce(w.data->>'phone',''),'[^0-9]','','g'),
    jsonb_path_query_array(w.data,'$.tests[*].name')::text${includeBill?",f.record_number":""}) ILIKE ALL($3::text[]))`;
}
