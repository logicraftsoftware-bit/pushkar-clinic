import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import jwt from 'jsonwebtoken';
import {firebasePhoneVerifier} from '../patient-app/firebase.mjs';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const now=Math.floor(Date.now()/1000),claims={sub:'synthetic-firebase-user',phone_number:'+919999999999',auth_time:now,iat:now,exp:now+3600,aud:'jiboncare',iss:'https://securetoken.google.com/jiboncare',firebase:{sign_in_provider:'phone'}};
function token(overrides={}){return jwt.sign({...claims,...overrides},privateKey,{algorithm:'RS256',keyid:'test'});}
test('Firebase verification pins project, signature, phone provider and recent authentication',async()=>{
  let requests=0;
  const verify=firebasePhoneVerifier(async()=>{requests++;return Response.json({test:publicKey.export({type:'spki',format:'pem'})},{headers:{'cache-control':'max-age=3600'}});});
  assert.equal((await verify(token(),'jiboncare')).sub,claims.sub);
  for(const changed of [{aud:'other-project'},{iss:'https://securetoken.google.com/other'},{exp:now-10},{iat:now+100},{auth_time:now-700},{auth_time:now+100},{phone_number:'+12025550123'},{firebase:{sign_in_provider:'password'}},{sub:''}])await assert.rejects(verify(token(changed),'jiboncare'),e=>e.status===401);
  await assert.rejects(verify(jwt.sign(claims,'synthetic-secret',{algorithm:'HS256',keyid:'test'}),'jiboncare'),e=>e.status===401);
  assert.equal(requests,1);
});
test('Firebase certificate service failures fail closed',async()=>{
  const verify=firebasePhoneVerifier(async()=>{throw Error('offline');});
  await assert.rejects(verify(token(),'jiboncare'),e=>e.status===503);
});
