import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
const bootstrap=html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
function fixture(retried=false){
  const listeners:Record<string,Function>={},navigation:string[]=[],children:any[]=[];
  const root={replaceChildren:(...nodes:any[])=>children.push(...nodes)};
  const window={location:{href:`https://erp.example/app/hospital-admin/lab-orders?lab=create${retried?"&_asset_retry=1":""}`,replace:(url:string)=>navigation.push(url)},addEventListener:(event:string,handler:Function)=>{listeners[event]=handler;}};
  const document={readyState:"complete",getElementById:()=>root,createElement:(tag:string)=>({tag,textContent:"",onclick:null})};
  runInNewContext(bootstrap,{window,document,URL,Date});
  return {listeners,navigation,children};
}
test("failed application module requests fresh HTML and preserves the create-order URL",()=>{
  const {listeners,navigation}=fixture();listeners.error!({target:{tagName:"SCRIPT",type:"module"}});
  const next=new URL(navigation[0]!);
  assert.equal(next.searchParams.get("lab"),"create");
  assert.ok(next.searchParams.has("_asset_retry"));
  listeners.error!({target:{tagName:"SCRIPT",type:"module"}});
  assert.equal(navigation.length,1);
});
test("failed retry shows a reload action instead of a blank page or an automatic reload loop",()=>{
  const {listeners,navigation,children}=fixture(true);listeners.error!({target:{tagName:"SCRIPT",type:"module"}});
  assert.equal(navigation.length,0);assert.match(children[0].textContent,/session is safe/);
  children[1].onclick();assert.equal(navigation.length,1);
});
test("outdated lazy chunks recover but unrelated image errors do not reload the page",()=>{
  const {listeners,navigation}=fixture();listeners.error!({target:{tagName:"IMG"}});assert.equal(navigation.length,0);
  let prevented=false;listeners["vite:preloadError"]!({preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,true);assert.equal(navigation.length,1);
});
