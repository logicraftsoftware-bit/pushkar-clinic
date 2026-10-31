// Reject excessive validation work before schema parsers can allocate one error per item.
export function withinJsonBudget(body,{nodes=40000,depth=30,items=2000,string=8000000}={}){
  const pending=[[body,0]];let visited=0;
  while(pending.length){
    const [value,level]=pending.pop();
    if(++visited>nodes||level>depth)return false;
    if(typeof value==='string'){if(value.length>string)return false;continue;}
    if(!value||typeof value!=='object')continue;
    if(Array.isArray(value)){if(value.length>items)return false;for(const child of value)pending.push([child,level+1]);}
    else{const keys=Object.keys(value);if(keys.length>items)return false;for(const key of keys)pending.push([value[key],level+1]);}
  }
  return true;
}
