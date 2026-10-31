import test from 'node:test';
import assert from 'node:assert/strict';
import {completion,cleanCompletion} from '../ai-provider.mjs';
test('AI adapter validates structured outputs and keeps provider secrets out of errors',async()=>{
  const options={key:'synthetic-secret',model:'synthetic-model',messages:[{role:'user',content:'Synthetic request'}],json:true};
  let called=false;
  const result=await completion(options,async(url,request)=>{called=true;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(request.redirect,'error');assert.equal(JSON.parse(request.body).response_format.type,'json_object');return Response.json({choices:[{message:{content:'```json\n{"symptoms":"test"}\n```'}}]});});assert.ok(called);assert.equal(result.symptoms,'test');
  await assert.rejects(completion({...options,key:''},()=>{throw new Error('must not call');}),error=>error.status===503);
  await assert.rejects(completion(options,async()=>new Response('synthetic-secret',{status:401})),error=>error.status===502&&!error.message.includes('synthetic-secret'));
  await assert.rejects(completion(options,async()=>Response.json({choices:[{message:{content:'invalid json'}}]})),error=>error.status===502);
  await assert.rejects(completion(options,async()=>{throw new Error('synthetic-secret');}),error=>error.status===502&&!error.message.includes('synthetic-secret'));
  assert.equal(cleanCompletion('<think>internal</think>Visible text'),'Visible text');
});
