import assert from "node:assert/strict";
import {test} from "node:test";
import {openWorkspaceTab} from "../../src/workspace-tab";

function fixture(blocked=false, denied=false, hint:string|null=null) {
  const events:unknown[][]=[];
  const tab={sessionStorage:{setItem:(key:string,value:string)=>{if(denied)throw new Error("Storage unavailable");events.push(["session",key,value]);}},opener:{} as unknown,location:{replace:(url:string)=>events.push(["navigate",url])},close:()=>events.push(["close"])};
  const browser={location:{origin:"https://erp.example",assign:(url:string)=>events.push(["fallback",url])},sessionStorage:{getItem:(key:string)=>{if(key==='careframe_portal_session_tab_hint')return hint;assert.equal(key,"careframe_portal_session");return '{"token":"existing-session"}';}},open:(url:string,target:string)=>{events.push(["open",url,target]);return blocked?null:tab;}};
  return {browser:browser as unknown as Pick<Window,"location"|"sessionStorage"|"open">,events,tab};
}

test("new ERP order tab receives the existing session before navigation and detaches its opener",()=>{
  const {browser,events,tab}=fixture();
  openWorkspaceTab(new URL("https://erp.example/app/reception/lab-orders?lab=create"),browser);
  assert.deepEqual(events.slice(0,2),[["open","about:blank","_blank"],["session","careframe_portal_session",'{"token":"existing-session"}']]);
  assert.equal(events[2]?.[0],"navigate");
  const destination=new URL(String(events[2]?.[1]));
  assert.equal(destination.pathname,"/app/reception/lab-orders");
  assert.equal(destination.searchParams.get("lab"),"create");
  assert.match(destination.searchParams.get("_workspace")||"",/^\d+$/);
  assert.equal(tab.opener,null);
});

test("blocked popup opens the form in the existing authenticated tab",()=>{
  const {browser,events}=fixture(true);
  openWorkspaceTab(new URL("https://erp.example/app/laboratory/orders?lab=create"),browser);
  assert.equal(events.at(-1)?.[0],"fallback");
});

test('programmatic workspace tabs copy the session hint for later native links and logout synchronization',()=>{
  const {browser,events}=fixture(false,false,'shared-tab-hint');
  openWorkspaceTab(new URL('https://erp.example/app/reception/lab-orders'),browser);
  assert.deepEqual(events[2],['session','careframe_portal_session_tab_hint','shared-tab-hint']);
  assert.equal(events[3]?.[0],'navigate');
});

test("storage failure closes the blank tab and preserves the current session via same-tab navigation",()=>{
  const {browser,events}=fixture(false,true);
  openWorkspaceTab(new URL("https://erp.example/app/reception/lab-orders?lab=create"),browser);
  assert.deepEqual(events.slice(-2).map(event=>event[0]),["close","fallback"]);
});

test("never transfers an ERP session to another origin",()=>{
  const {browser,events}=fixture();
  assert.throws(()=>openWorkspaceTab(new URL("https://other.example/"),browser),/ERP origin/);
  assert.deepEqual(events,[]);
});
