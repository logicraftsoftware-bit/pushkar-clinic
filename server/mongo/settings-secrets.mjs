const secretKey=/^(password|api_key|api_secret|secret|token|client_secret|private_key|access_key|access_token)$/i;
export const secretMask='********';
export function maskSettings(value,key='') {
  if(secretKey.test(key)&&typeof value==='string'&&value)return secretMask;
  if(Array.isArray(value))return value.map(item=>maskSettings(item));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,item])=>[field,maskSettings(item,field)]));
  return value;
}
export function preserveSettingsSecrets(value,previous,key='') {
  if(secretKey.test(key)&&value===secretMask)return previous??'';
  if(Array.isArray(value))return value.map((item,index)=>preserveSettingsSecrets(item,previous?.[index]));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,item])=>[field,preserveSettingsSecrets(item,previous?.[field],field)]));
  return value;
}
