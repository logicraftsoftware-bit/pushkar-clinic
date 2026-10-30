type Row=Record<string,any>;

export function isPapSmearTest(test:Row):boolean{
  return /^pap[\s-]*smear(?:\s*\([^)]*\))?(?:\s*\[[^\]]+\])?$/i.test(String(test.name||test.test_name||'').trim());
}

// These urine microscopy values may be counts, ranges or descriptive text.
// Scope the override to Urine R/E; shared parameter masters keep their formats.
export function normalizeLabResultFormats(tests:Row[]):Row[]{
  return tests.map(test=>{
    if(isPapSmearTest(test))return {...test,parameters:(test.parameters||[]).map((parameter:Row)=>['0','5'].includes(String(parameter.result_type_id))?parameter:{...parameter,result_type_id:'27',formula:''})};
    if(!/^urine\s*r\s*[/.\-]?\s*e\b/i.test(String(test.name||test.test_name||'').trim()))return test;
    return {...test,parameters:(test.parameters||[]).map((parameter:Row)=>{
      const name=String(parameter.name||'').toLowerCase().replace(/[^a-z]/g,'');
      return ['sediment','puscell','puscells','rbc','rbcs'].includes(name)?{...parameter,result_type_id:'3',formula:''}:parameter;
    })};
  });
}
