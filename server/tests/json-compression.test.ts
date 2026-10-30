import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {get} from 'node:http';
import {gunzipSync} from 'node:zlib';
import type {AddressInfo} from 'node:net';
import {jsonCompression} from '../src/json-compression.js';
import {patientNameResponse} from '../src/patient-name-response.js';

test('JSON compression preserves patient formatting and encoding negotiation without changing streams or downloads',async()=>{
  const app=express();app.use(jsonCompression);app.use(patientNameResponse);
  const rows=Array.from({length:200},(_,id)=>({id,patient_name:'Test Patient',status:'Pending'}));
  app.get('/rows',(_req,res)=>res.json(rows));
  app.get('/small',(_req,res)=>res.json({ok:true}));
  app.get('/private',(_req,res)=>res.set('Cache-Control','no-transform').json(rows));
  app.get('/existing',(_req,res)=>res.set('Content-Encoding','identity').json(rows));
  app.get('/download',(_req,res)=>res.type('application/pdf').send(Buffer.from('download')));
  app.get('/events',(_req,res)=>res.type('text/event-stream').end('data: refresh\n\n'));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  function load(path:string,encoding='gzip'){
    return new Promise<{body:Buffer;headers:import('node:http').IncomingHttpHeaders}>((resolve,reject)=>{
      get(base+path,{headers:{'Accept-Encoding':encoding}},response=>{
        const parts:Buffer[]=[];response.on('data',part=>parts.push(part));
        response.on('end',()=>resolve({body:Buffer.concat(parts),headers:response.headers}));
      }).on('error',reject);
    });
  }
  try{
    const compressed=await load('/rows'),plain=await load('/rows','identity');
    assert.equal(compressed.headers['content-encoding'],'gzip');
    assert.match(String(compressed.headers.vary),/Accept-Encoding/);
    assert.ok(compressed.body.length<plain.body.length/4);
    assert.deepEqual(gunzipSync(compressed.body),plain.body);
    assert.equal(JSON.parse(plain.body.toString())[0].patient_name,'TEST PATIENT');
    assert.equal((await load('/rows','gzip;q=0, identity')).headers['content-encoding'],undefined);
    for(const path of ['/small','/private','/download','/events'])assert.equal((await load(path)).headers['content-encoding'],undefined,path);
    assert.equal((await load('/existing')).headers['content-encoding'],'identity');
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
