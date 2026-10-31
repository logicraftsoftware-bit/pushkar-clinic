// Provider reference: https://console.groq.com/docs/api-reference and /docs/vision.
const failure=(message,status)=>Object.assign(new Error(message),{status});
export function cleanCompletion(text){return String(text??'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/^```(?:json|text)?\s*/i,'').replace(/\s*```$/,'').trim();}
export async function completion({key,model,messages,json=false,tokens=1000},fetcher=globalThis.fetch){
  if(!key)throw failure('AI is not configured. Add GROQ_API_KEY privately on the hosting server.',503);
  let response,payload;
  try{
    response=await fetcher('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,messages,temperature:0,max_completion_tokens:tokens,...(json?{response_format:{type:'json_object'}}:{})}),signal:AbortSignal.timeout(30000),redirect:'error'});
    if(!response.ok)throw failure('AI provider request failed. Check the server model configuration or try again.',502);
    payload=await response.json();
  }catch(error){if(error?.status===502)throw error;throw failure('AI provider is unavailable. Try again later.',502);}
  const raw=payload?.choices?.[0]?.message?.content;if(typeof raw!=='string'||raw.length>100000)throw failure('AI returned an invalid response. Try again.',502);
  const text=cleanCompletion(raw);if(!text)throw failure('AI returned an empty response. Try again.',502);
  if(!json)return text;
  try{return JSON.parse(text);}catch{throw failure('AI returned an invalid structured draft. Try again.',502);}
}
