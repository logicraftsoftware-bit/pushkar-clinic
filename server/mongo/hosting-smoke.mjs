import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {MongoClient} from 'mongodb';

if(process.env.MONGODB_INTEGRATION_TEST!=='true'||!/^pushkar_test_/.test(process.env.MONGODB_DB??''))throw new Error('Hosting tests require an explicitly disposable test database.');
const root=fileURLToPath(new URL('../../',import.meta.url));
const port='4199',base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['hosting-mongo.mjs'],{cwd:root,env:{...process.env,PORT:port,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
let exited=false;child.once('exit',()=>{exited=true;});
// Startup messages contain no environment configuration; do not forward child logs.
child.stdout.resume();child.stderr.resume();
try{
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    if(exited)throw new Error('Managed hosting entry point exited before becoming ready.');
    try{const health=await fetch(base+'/api/v1/health');if(health.ok){const body=await health.json();assert.equal(body.database,'mongodb');ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Native hosting API becomes healthy');
  for(const path of ['/','/superadmin','/portal/staff']){const page=await fetch(base+path);assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(await page.text(),/<div id="root"><\/div>/);}
  const missing=await fetch(base+'/api/v1/missing-workflow');assert.match(missing.headers.get('content-type'),/application\/json/);assert.equal(missing.status,501);
  const stopped=once(child,'exit');child.kill('SIGTERM');const [code]=await stopped;assert.equal(code,0,'Hosting shuts down without leaving database connections open');
  console.log('Native Hostinger entry point passed API, SPA and graceful shutdown checks.');
}finally{
  if(!exited)child.kill('SIGKILL');
  const client=new MongoClient(process.env.MONGODB_URI);try{await client.connect();await client.db(process.env.MONGODB_DB).dropDatabase();}finally{await client.close();}
}
