// Run from the repository root after a production build:
// node server/performance/workspace-tabs-browser.mjs
// Uses only an isolated local mock API and Chrome profile. Set CHROME_PATH if needed.
import {createServer} from 'node:http';
import {readFile,mkdtemp,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const chromePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'/usr/bin/google-chrome');
await access(chromePath).catch(()=>{throw Error('Chrome is required for this local browser check. Set CHROME_PATH to its executable.');});
const requests=[],errors=[],authRequests=[];
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
  if(url.pathname.startsWith('/api/')){
    res.setHeader('Content-Type','application/json');
    if(!url.pathname.endsWith('/branding')){authRequests.push({path:url.pathname,authorization:req.headers.authorization});if(!['Bearer alice-session','Bearer bob-session','Bearer admin-session'].includes(req.headers.authorization)){res.statusCode=401;res.end(JSON.stringify({code:'ACCESS_REVOKED',error:'Missing test session'}));return;}}
    if(url.pathname==='/api/v1/admin/hospitals'){res.end(JSON.stringify({data:[]}));return;}
    if(url.pathname==='/api/v1/admin/modules'){res.end('[]');return;}
    if(url.pathname.endsWith('/session/events')){res.setHeader('Content-Type','text/event-stream');res.write('data: connected\n\n');return;}
    const people=Array.from({length:60},(_,i)=>({id:'p'+(i+1),first_name:'PERSON'+(i+1),last_name:'TEST',name:'PERSON'+(i+1)+' TEST',medical_record_number:'UHID-'+(i+1),phone:'9876543210',created_at:'2026-10-29T09:00:00Z',branch_id:'main',branch_name:'Main',sex:'unknown',status:'Active',registration_fee:0,registration_addons:[],total_amount:0}));
    const selected=people.filter(row=>!url.searchParams.get('search')||(row.first_name+' '+row.medical_record_number).toLowerCase().includes(url.searchParams.get('search').toLowerCase()));
    const page=Number(url.searchParams.get('page')||1),pageRows=selected.slice((page-1)*25,page*25);
    if(url.pathname==='/api/v1/patients'){res.end(JSON.stringify({rows:pageRows,total:selected.length,page,page_size:25}));return;}
    if(url.pathname==='/api/v1/clinical/appointments'){res.end(JSON.stringify({rows:pageRows.map(row=>({...row,patient_name:row.first_name+' '+row.last_name,patient_id:row.id,status:'Booked',appointment_number:'APT-'+row.id,appointment_date:'2026-10-29',appointment_time:'09:00',token_number:row.id,doctor_name:'Test Doctor',department_name:'General'})),total:selected.length,summary:{Booked:selected.length},dates:[],page,page_size:25}));return;}
    if(url.pathname==='/api/v1/clinical/lookups'){res.end(JSON.stringify({patients:[],branches:[{id:'main',name:'Main'}],doctors:[],departments:[],wards:[],rooms:[],beds:[]}));return;}
    if(url.pathname==='/api/v1/clinical/patient-search'){res.end(JSON.stringify(selected.slice(0,25)));return;}
    const value=url.pathname.endsWith('/branding')?{name:'Medicity Test',logo:''}:url.pathname.endsWith('/access-control/me')?{permissions:['lab.order.view','menu.lab-orders.view','menu.dashboard.view','menu.patients.view','menu.appointments.view','billing.view','patient.view','patient.create','patient.update','appointment.view','appointment.create'],roles:[],managed_roles:[]}:url.pathname.startsWith('/api/v1/dashboard/')?{metrics:[],trendData:[],departments:[],queue:[],activityFeed:[],filters:{branches:[],departments:[]},totals:{}}:url.pathname.endsWith('/lab-orders')?{rows:[],total:0,summary:{total:0,awaiting:0,progress:0,ready:0,unpaid:0}}:[];
    res.end(JSON.stringify(value));return;
  }
  try{const relative=url.pathname.startsWith('/assets/')?url.pathname.slice(1):'index.html';const data=await readFile(path.join(root,'dist',relative));res.setHeader('Content-Type',relative.endsWith('.js')?'application/javascript':relative.endsWith('.css')?'text/css':relative.endsWith('.png')?'image/png':'text/html');res.end(data);}catch{res.statusCode=404;res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`,profile=await mkdtemp(path.join(tmpdir(),'medicity-workspace-tabs-'));
const chrome=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const clients=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let port;
async function connect(id){
  const pages=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page=pages.find(page=>page.id===id);assert.ok(page,'Target available');
  const socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  let seq=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);message.error?request.reject(Error(message.error.message)):request.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);});
  const command=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const value=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(value.exceptionDetails)throw Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
  const until=async expression=>{for(let i=0;i<150;i++){if(await evaluate(expression))return;await delay(100);}throw Error('Timed out: '+expression+' '+JSON.stringify(await evaluate('({path:location.pathname,text:document.body.innerText.slice(0,1000),hasSession:!!sessionStorage.getItem("careframe_portal_session")})')));};
  await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await command('Runtime.enable');await command('Page.enable');const client={command,evaluate,until,close:()=>socket.close(),id};clients.push(client);return client;
}
async function navigate(client,path){await client.command('Page.navigate',{url:origin+path});}
async function openFresh(source,href){const result=await source.command('Target.createTarget',{url:href});return connect(result.targetId);}
async function nativeOpen(source,selector,button,modifiers=0){
  await source.command('Page.bringToFront');
  const old=new Set((await source.command('Target.getTargets')).targetInfos.map(target=>target.targetId));
  const point=await source.evaluate(`(()=>{const link=document.querySelector(${JSON.stringify(selector)});link.scrollIntoView({block:'center'});const r=link.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await source.command('Input.dispatchMouseEvent',{type:'mousePressed',button,buttons:button==='middle'?4:1,modifiers,clickCount:1,...point});
  await source.command('Input.dispatchMouseEvent',{type:'mouseReleased',button,buttons:0,modifiers,clickCount:1,...point});
  for(let i=0;i<100;i++){const created=(await source.command('Target.getTargets')).targetInfos.find(target=>target.type==='page'&&!old.has(target.targetId));if(created)return connect(created.targetId);await delay(100);}
  throw Error('Native click did not open a tab');
}
try{
  for(let i=0;i<100;i++){try{port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
  assert.ok(port);const initial=await(await fetch(`http://127.0.0.1:${port}/json`)).json();
  const alice=await connect(initial.find(page=>page.type==='page').id);
  await navigate(alice,'/login');await alice.until('!!document.querySelector("input")');
  const session=(token,name,portal='hospital_admin',role='hospital_admin')=>({token,user:{id:name,name,role,portal},hospital:{id:'test',name:'Test Hospital',code:'TEST',branchName:'Main'},modules:[]});
  await alice.evaluate(`sessionStorage.clear();sessionStorage.setItem('careframe_portal_session',${JSON.stringify(JSON.stringify(session('alice-session','Alice')))})`);
  await navigate(alice,'/app/hospital-admin/lab-orders');await alice.until('!!document.querySelector(".lo-table-card")');
  const patients='a[href*="/app/hospital-admin/patients?"]';
  await alice.until(`!!document.querySelector(${JSON.stringify(patients)})`);
  const href=await alice.evaluate(`document.querySelector(${JSON.stringify(patients)}).href`);
  assert.ok(href.includes('_session='));assert.ok(!href.includes('alice-session'));assert.equal(await alice.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(patients)})).display`),'flex');
  await alice.evaluate(`document.addEventListener('contextmenu',event=>{setTimeout(()=>{window.contextMenuResult={link:event.target.closest('a')?.href,prevented:event.defaultPrevented}},0)},{once:true})`);
  const rect=await alice.evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(patients)});a.scrollIntoView({block:'center'});const r=a.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await alice.command('Input.dispatchMouseEvent',{type:'mousePressed',button:'right',buttons:2,clickCount:1,...rect});
  await alice.command('Input.dispatchMouseEvent',{type:'mouseReleased',button:'right',buttons:0,clickCount:1,...rect});
  await alice.until('!!window.contextMenuResult');assert.equal((await alice.evaluate('window.contextMenuResult')).prevented,false);assert.equal((await alice.evaluate('window.contextMenuResult')).link,href);
  await alice.command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',windowsVirtualKeyCode:27});await alice.command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',windowsVirtualKeyCode:27});
  const fresh=await openFresh(alice,href);await fresh.until('document.querySelectorAll(".pt-card tbody tr").length===25');
  assert.equal(await fresh.evaluate('JSON.parse(sessionStorage.getItem("careframe_portal_session")).token'),'alice-session');
  assert.equal(await alice.evaluate('location.pathname'),'/app/hospital-admin/lab-orders');
  const ctrl=await nativeOpen(alice,patients,'left',2);await ctrl.until('!!document.querySelector(".pt-card")');
  const middle=await nativeOpen(alice,patients,'middle');await middle.until('!!document.querySelector(".pt-card")');
  for(const tab of [ctrl,middle])assert.equal(await tab.evaluate('JSON.parse(sessionStorage.getItem("careframe_portal_session")).token'),'alice-session');
  assert.equal(await alice.evaluate('location.pathname'),'/app/hospital-admin/lab-orders');
  await alice.evaluate('window.spaSentinel=123');await alice.evaluate(`document.querySelector(${JSON.stringify(patients)}).click()`);await alice.until('!!document.querySelector(".pt-card")');assert.equal(await alice.evaluate('window.spaSentinel'),123);
  const bob=await openFresh(alice,origin+'/login');await bob.until('!!document.querySelector("input")');await bob.evaluate(`sessionStorage.clear();sessionStorage.setItem('careframe_portal_session',${JSON.stringify(JSON.stringify(session('bob-session','Bob')))})`);await navigate(bob,'/app/hospital-admin/lab-orders');await bob.until('!!document.querySelector(".lo-table-card")');
  const aliceAgain=await openFresh(alice,await alice.evaluate(`document.querySelector(${JSON.stringify(patients)}).href`));await aliceAgain.until('!!document.querySelector(".pt-card")');assert.equal(await aliceAgain.evaluate('JSON.parse(sessionStorage.getItem("careframe_portal_session")).token'),'alice-session');
  const reception=await openFresh(alice,origin+'/login');await reception.until('!!document.querySelector("input")');await reception.evaluate(`sessionStorage.clear();sessionStorage.setItem('careframe_portal_session',${JSON.stringify(JSON.stringify(session('bob-session','Reception','receptionist','receptionist')))})`);await navigate(reception,'/app/reception/lab-orders');await reception.until('!!document.querySelector(".lo-table-card")');assert.ok(await reception.evaluate('!!document.querySelector(".hospital-nav a[href*=patient-registration]")'));
  const receptionTab=await openFresh(reception,await reception.evaluate('document.querySelector(".hospital-nav a[href*=patient-registration]").href'));await receptionTab.until('!!document.querySelector(".pt-card")');assert.equal(await receptionTab.evaluate('JSON.parse(sessionStorage.getItem("careframe_portal_session")).user.name'),'Reception');
  const admin=await openFresh(alice,origin+'/superadmin/login');await admin.until('!!document.querySelector("input")');await admin.evaluate('sessionStorage.clear();sessionStorage.setItem("careframe_superadmin_token","admin-session")');await navigate(admin,'/superadmin/modules');await admin.until('!!document.querySelector(".sa-app aside nav a")');
  const adminTab=await openFresh(admin,await admin.evaluate('document.querySelector(".sa-app aside nav a[href*=hospitals]").href'));await adminTab.until('!!document.querySelector(".sa-app aside nav a")');assert.equal(await adminTab.evaluate('sessionStorage.getItem("careframe_superadmin_token")'),'admin-session');assert.equal(await adminTab.evaluate('sessionStorage.getItem("careframe_portal_session")'),null);
  assert.equal(authRequests.filter(request=>request.path.endsWith('/session/events')).length,1,'Many tabs share one live access connection');
  assert.ok(await adminTab.evaluate('document.querySelectorAll(".sa-mobile-footer a[href*=_session]").length===5'));
  await alice.command('Target.closeTarget',{targetId:alice.id});
  assert.equal(await fresh.evaluate('JSON.parse(sessionStorage.getItem("careframe_portal_session")).token'),'alice-session');
  await fresh.evaluate('window.dispatchEvent(new CustomEvent("session-invalid",{detail:"Test logout"}))');await fresh.until('sessionStorage.getItem("careframe_portal_session")===null');assert.equal(await bob.evaluate('JSON.parse(sessionStorage.getItem("careframe_portal_session")).token'),'bob-session');
  assert.deepEqual(errors,[]);assert.ok(authRequests.length>10);assert.ok(authRequests.every(request=>['Bearer alice-session','Bearer bob-session','Bearer admin-session'].includes(request.authorization)));
  console.log(JSON.stringify({result:'PASS',scope:'Local production build and mock API only',checks:['native context menu link','fresh no-opener session handoff','Ctrl-click new tab','middle-click new tab','normal SPA navigation','different staff isolated','reception menus','Super Admin menus and scope','logout synchronization','single shared access stream','source tab can close'],browser_exceptions:errors.length}));
}finally{for(const client of clients)client.close();chrome.kill();server.closeAllConnections();await new Promise(r=>server.close(r));}
