type Row=Record<string,any>;

// Omit blank and numeric-zero results. Keep a heading only when that section
// contains a result, and never change the saved clinical values.
export function reportParameters(test:Row):Row[]{
  const rows:Row[]=[];
  let heading:Row|undefined,headingPrinted=false;
  for(const parameter of test.parameters||[]){
    const type=String(parameter.result_type_id??'');
    if(type==='0'){heading=parameter;headingPrinted=false;continue;}
    if(type==='5'){heading=undefined;headingPrinted=false;continue;}
    const value=String(parameter.value??'').trim();
    if(!value||Number(value)===0)continue;
    if(heading&&!headingPrinted){rows.push(heading);headingPrinted=true;}
    rows.push(parameter);
  }
  return rows;
}
