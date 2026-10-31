import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {MongoClient} from 'mongodb';

if(process.env.MONGODB_INTEGRATION_TEST!=='true'||!/^pushkar_test_/.test(process.env.MONGODB_DB??''))throw new Error('Hosting tests require an explicitly disposable test database.');
const root=fileURLToPath(new URL('../../',import.meta.url));
const port='4199',base=`http://127.0.0.1:${port}`;
const child=spawn(process.execPath,['hosting.mjs'],{cwd:root,env:{...process.env,PORT:port,NODE_ENV:'test',BOOTSTRAP_ADMIN_USERNAME:'synthetic-hosting-owner',BOOTSTRAP_ADMIN_PASSWORD:'Synthetic-hosting-password-123'},stdio:['ignore','pipe','pipe']});
async function listeningWithinDeadline(process){
  await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error('Hosting must call listen within three seconds.')),3000);
    process.stdout.on('data',chunk=>{output+=chunk.toString();if(output.includes('listening on port')){clearTimeout(timer);resolve();}});
    process.once('exit',()=>{clearTimeout(timer);reject(new Error('Hosting exited before calling listen.'));});
  });
}
const firstListen=listeningWithinDeadline(child);let blocked;
let exited=false;child.once('exit',()=>{exited=true;});
// Startup messages contain no environment configuration; do not forward child logs.
child.stdout.resume();child.stderr.resume();
try{
  await firstListen;
  let ready=false;
  for(let attempt=0;attempt<120;attempt++){
    if(exited)throw new Error('Managed hosting entry point exited before becoming ready.');
    try{const health=await fetch(base+'/api/v1/health');if(health.ok){const body=await health.json();assert.equal(body.database,'mongodb');ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Native hosting API becomes healthy');
  const login=await fetch(base+'/api/v1/admin/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'synthetic-hosting-owner',password:'Synthetic-hosting-password-123'})});assert.equal(login.status,200,'Private hosting environment bootstraps the first owner');
  for(const path of ['/','/superadmin','/portal/staff']){const page=await fetch(base+path);assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);assert.match(await page.text(),/<div id="root"><\/div>/);}
  const missing=await fetch(base+'/api/v1/missing-workflow');assert.match(missing.headers.get('content-type'),/application\/json/);assert.equal(missing.status,404);
  const stopped=once(child,'exit');child.kill('SIGTERM');const [code]=await stopped;assert.equal(code,0,'Hosting shuts down without leaving database connections open');
  // A failed database connection must not prevent Hostinger from starting the site.
  blocked=spawn(process.execPath,['hosting.mjs'],{cwd:root,env:{...process.env,PORT:port,NODE_ENV:'test',MONGODB_URI:'mongodb://127.0.0.1:1/',BOOTSTRAP_ADMIN_USERNAME:'synthetic-hosting-owner',BOOTSTRAP_ADMIN_PASSWORD:'Synthetic-hosting-password-123'},stdio:['ignore','pipe','pipe']});
  const blockedListen=listeningWithinDeadline(blocked);blocked.stdout.resume();blocked.stderr.resume();await blockedListen;
  const page=await fetch(base+'/superadmin');assert.equal(page.status,200);
  const unavailable=await fetch(base+'/api/v1/health');assert.equal(unavailable.status,503);assert.match(unavailable.headers.get('content-type'),/application\/json/);assert.equal((await unavailable.json()).code,'DATABASE_INITIALIZING');
  const blockedExit=once(blocked,'exit');blocked.kill('SIGTERM');const [blockedCode]=await blockedExit;assert.equal(blockedCode,0);blocked=null;
  console.log('Native Hostinger entry passed fast startup, failed-database isolation, API, SPA and graceful shutdown checks.');
}finally{
  if(!exited)child.kill('SIGKILL');
  if(blocked)blocked.kill('SIGKILL');
  const client=new MongoClient(process.env.MONGODB_URI);try{await client.connect();await client.db(process.env.MONGODB_DB).dropDatabase();}finally{await client.close();}
}
