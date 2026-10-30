import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTabSessionBridge,PORTAL_SESSION_KEY,ADMIN_SESSION_KEY} from '../../src/tab-session.js';
import {isPlainNavigationClick} from '../../src/navigation.js';

function host(href='https://erp.example/app/reception/lab-orders'){
  const values=new Map<string,string>(),events:Event[]=[];
  const browser={location:{href},sessionStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}},
    dispatchEvent:(event:Event)=>{events.push(event);return true;},history:{replaceState:(_data:unknown,_title:string,url?:string|URL|null)=>{if(url)browser.location.href=String(url);}}};
  return {...browser,values,events};
}
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));

test('native new tabs restore the exact staff session using a non-credential hint and retain route filters',async()=>{
  const name='erp-tabs-'+crypto.randomUUID(),source=host();
  const from=createTabSessionBridge(source,new BroadcastChannel(name));
  const value=JSON.stringify({token:'signed-in-secret',user:{id:'reception-1'},hospital:{id:'hospital'}});
  from.write(PORTAL_SESSION_KEY,value);
  const href=from.href('/app/reception/patients?search=Patient#registry');
  assert.ok(!href.includes('signed-in-secret'));assert.ok(!href.includes('reception-1'));
  const target=host(new URL(href,'https://erp.example').href),to=createTabSessionBridge(target,new BroadcastChannel(name));
  try{
    assert.equal(to.read(PORTAL_SESSION_KEY),null);
    assert.equal(await to.restore(PORTAL_SESSION_KEY),value);
    assert.equal(to.read(PORTAL_SESSION_KEY),value);assert.equal(from.read(PORTAL_SESSION_KEY),value);
    const destination=new URL(target.location.href);assert.equal(destination.pathname,'/app/reception/patients');assert.equal(destination.searchParams.get('search'),'Patient');assert.equal(destination.hash,'#registry');assert.equal(destination.searchParams.has('_session'),false);
    const updated=JSON.stringify({token:'signed-in-secret',forcePasswordChange:true});
    from.write(PORTAL_SESSION_KEY,updated);await pause();assert.equal(to.read(PORTAL_SESSION_KEY),updated);
    from.clear(PORTAL_SESSION_KEY);await pause();assert.equal(to.read(PORTAL_SESSION_KEY),null);
  }finally{from.close();to.close();}
});

test('multiple staff accounts stay separate and closing a source tab does not sign out restored tabs',async()=>{
  const name='erp-tabs-'+crypto.randomUUID(),alice=host(),bob=host();
  const a=createTabSessionBridge(alice,new BroadcastChannel(name)),b=createTabSessionBridge(bob,new BroadcastChannel(name));
  a.write(PORTAL_SESSION_KEY,'{"token":"alice"}');b.write(PORTAL_SESSION_KEY,'{"token":"bob"}');
  const target=host(new URL(a.href('/app/reception/patients'),'https://erp.example').href),tab=createTabSessionBridge(target,new BroadcastChannel(name));
  try{
    assert.equal(await tab.restore(PORTAL_SESSION_KEY),'{"token":"alice"}');
    b.clear(PORTAL_SESSION_KEY);await pause();assert.equal(tab.read(PORTAL_SESSION_KEY),'{"token":"alice"}');
    a.close();assert.equal(tab.read(PORTAL_SESSION_KEY),'{"token":"alice"}');
  }finally{a.close();b.close();tab.close();}
});

test('administrator sessions use a separate scope and unrelated replies cannot replace a session',async()=>{
  const name='erp-tabs-'+crypto.randomUUID(),source=host('https://erp.example/superadmin/hospitals');
  const from=createTabSessionBridge(source,new BroadcastChannel(name));from.write(ADMIN_SESSION_KEY,'admin-secret');
  const href=from.href('/superadmin/modules',ADMIN_SESSION_KEY),target=host(new URL(href,'https://erp.example').href);
  const to=createTabSessionBridge(target,new BroadcastChannel(name),()=>crypto.randomUUID(),100);
  const outsider=new BroadcastChannel(name);
  try{
    assert.equal(await to.restore(PORTAL_SESSION_KEY),null);
    assert.equal(await to.restore(ADMIN_SESSION_KEY),'admin-secret');
    outsider.postMessage({origin:'https://erp.example',key:ADMIN_SESSION_KEY,hint:'wrong',id:'wrong',type:'response',value:'attacker'});
    await pause();assert.equal(to.read(ADMIN_SESSION_KEY),'admin-secret');assert.equal(to.read(PORTAL_SESSION_KEY),null);
    assert.throws(()=>to.href('https://other.example/'),/ERP origin/);
  }finally{from.close();to.close();outsider.close();}
});

test('missing peers and a cleared pending restore leave the new tab unauthenticated',async()=>{
  const browser=host('https://erp.example/app/reception/patients?_session=missing');
  const bridge=createTabSessionBridge(browser,new BroadcastChannel('erp-tabs-'+crypto.randomUUID()),()=>crypto.randomUUID(),50);
  try{
    const request=bridge.restore(PORTAL_SESSION_KEY);bridge.clear(PORTAL_SESSION_KEY);assert.equal(await request,null);
    assert.equal(await bridge.restore(PORTAL_SESSION_KEY),null);assert.equal(bridge.read(PORTAL_SESSION_KEY),null);
  }finally{bridge.close();}
});

test('only ordinary left clicks use SPA navigation; context, middle and modified clicks retain browser defaults',()=>{
  const normal={button:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,defaultPrevented:false};
  assert.equal(isPlainNavigationClick(normal),true);
  for(const change of [{button:1},{button:2},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}])assert.equal(isPlainNavigationClick({...normal,...change}),false);
});
