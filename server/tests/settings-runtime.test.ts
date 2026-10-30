import {test,after} from 'node:test';
import assert from 'node:assert/strict';
process.env.DATABASE_URL='postgresql://test:test@localhost/test';
process.env.JWT_SECRET='settings-performance-test-secret-at-least-32-characters';
const {pool}=await import('../src/db.js');
const {operationalSettings}=await import('../src/settings-runtime.js');
const original=pool.query;

test('operational settings load in one tenant-scoped query and keep updates fresh',async()=>{
  let calls=0,gateway='Razorpay';
  (pool as any).query=async(sql:string,args:any[])=>{
    calls++;assert.match(sql,/tenant_id=\$1 AND section=ANY\(\$2::text\[\]\)/);
    assert.equal(args[0],'hospital');assert.equal(args[1].length,7);
    return {rows:[{section:'GeneralSetting',key:'name',value:'Hospital'},
      {section:'PaymentMethods',key:'selected_gateway',value:gateway},
      {section:'PrefixSetting',key:'invoice',value:'INV'}]};
  };
  try{
    const settings=await operationalSettings('hospital');assert.equal(calls,1);
    assert.deepEqual(settings.general,{name:'Hospital'});assert.deepEqual(settings.languages,{});
    assert.deepEqual(settings.prefix,{invoice:'INV'});assert.ok(settings.payment_methods.includes('Razorpay'));
    gateway='None';assert.ok(!(await operationalSettings('hospital')).payment_methods.includes('Razorpay'));assert.equal(calls,2);
  }finally{pool.query=original;}
});
after(()=>pool.end());
