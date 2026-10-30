export function qcEvaluation(value:number,target:number,sd:number) {
  if(![value,target,sd].every(Number.isFinite)||sd<=0)throw new Error("QC values must be finite and standard deviation positive");
  const z=(value-target)/sd;
  return {z_score:Number(z.toFixed(4)),status:Math.abs(z)>=3?"Out of Control":Math.abs(z)>=2?"Warning":"In Control"};
}
export function calculateLabFormula(formula:string,parameters:Record<string,string|number>,decimals=2):string {
  const expression=formula.replace(/@/g,"").replace(/p(\d+)/g,(_,id:string)=>{
    const value=parameters[id];
    if(value===undefined||String(value).trim()===""||!Number.isFinite(Number(value)))throw new Error(`Formula needs numeric parameter ${id}`);
    return `(${Number(value)})`;
  });
  if(!/^[\d.()+*/\-\s]+$/.test(expression))throw new Error("Unsupported formula syntax");
  const tokens=expression.match(/\d+(?:\.\d+)?|\.\d+|[()+*/-]/g)||[];
  let position=0;
  function primary():number {
    const token=tokens[position++];
    if(token==="-")return -primary();
    if(token==="+")return primary();
    if(token==="("){const value=add();if(tokens[position++]!==")")throw new Error("Unbalanced formula parentheses");return value;}
    if(token===undefined||!/^\d*\.?\d+$/.test(token))throw new Error("Invalid formula operand");
    return Number(token);
  }
  function multiply():number{let result=primary();while(tokens[position]==="*"||tokens[position]==="/"){const op=tokens[position++],right=primary();if(op==="/"&&right===0)throw new Error("Formula divides by zero");result=op==="*"?result*right:result/right;}return result;}
  function add():number{let result=multiply();while(tokens[position]==="+"||tokens[position]==="-"){const op=tokens[position++],right=multiply();result=op==="+"?result+right:result-right;}return result;}
  const result=add();if(position!==tokens.length||!Number.isFinite(result))throw new Error("Invalid formula result");
  return result.toFixed(Math.max(0,Math.min(8,decimals)));
}
export function selectLabReference(ranges:Record<string,any>[],sex:string,ageDays:number|null) {
  const gender=sex.toUpperCase();
  const matched=ranges.filter(row=>{
    if(row.age_type&&String(row.age_type).toLowerCase()!=="days")return false;
    const ruleGender=String(row.sex||"").toUpperCase();
    if(ruleGender&&ruleGender!=="0"&&ruleGender!==gender)return false;
    if(ageDays===null)return Number(row.age_from||0)===0&&Number(row.age_to||0)===0;
    const from=Number(row.age_from||0),to=Number(row.age_to||0);
    return ageDays>=from&&(to===0||ageDays<=to);
  });
  // Ambiguous or overlapping rules must be resolved in the master, not guessed.
  return matched.length===1?matched[0]:null;
}

export function laboratoryReference(ranges:Record<string,any>[],sex:string,ageDays:number|null,legacyRangeId?:string){
  const recorded=legacyRangeId&&legacyRangeId!=="0"?ranges.filter(row=>String(row.slno)===legacyRangeId):[];
  const rule=recorded.length===1?recorded[0]:selectLabReference(ranges,sex,ageDays);
  if(rule){
    const from=String(rule.value_from??""),to=String(rule.value_to??""),text=String(rule.normal_range||"");
    // Legacy 0/0 bounds are placeholders when a textual rule supplies the interval.
    const placeholder=text&&Number(from||0)===0&&Number(to||0)===0;
    return {reference_from:placeholder?"":from,reference_to:placeholder?"":to,reference_text:text,reference_rule_id:String(rule.slno||""),reference_source:recorded.length===1?"Recorded legacy rule":"Parameter reference rule"};
  }
  const alternatives=ranges.map(row=>{
    const labels=[row.sex&&row.sex!=="0"?row.sex:"",Number(row.age_from||0)||Number(row.age_to||0)?`Age ${row.age_from||0}–${row.age_to||"any"} ${row.age_type||"days"}`:""].filter(Boolean);
    const interval=row.normal_range||[row.value_from,row.value_to].filter(value=>value!==undefined&&value!=="").join(" – ");
    return interval?`${labels.length?labels.join(", ")+": ":""}${interval}`:"";
  }).filter(Boolean);
  return {reference_from:"",reference_to:"",reference_text:[...new Set(alternatives)].join("\n"),reference_rule_id:"",reference_source:alternatives.length?"Reference rules; patient-specific match unavailable":""};
}
