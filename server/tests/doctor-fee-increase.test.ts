import assert from 'node:assert/strict';
import {test} from 'node:test';
import {increasedDoctorFees,increaseAllDoctorFees} from '../src/doctor-fee-increase.js';

test('adds Rs100 to default and each branch fee while retaining all other settings',()=>{
  const original={consultation_fee:'700',follow_up_fee:200,specialization:'Medicine',branch_fees:{main:{consultation_fee:800,department_id:'dept'},other:{consultation_fee:500},fallback:{consultation_fee:null}}};
  const result=increasedDoctorFees(original);
  assert.equal(result.consultation_fee,800);assert.equal(result.branch_fees.main.consultation_fee,900);assert.equal(result.branch_fees.other.consultation_fee,600);assert.equal(result.branch_fees.fallback.consultation_fee,800);
  assert.equal(result.follow_up_fee,200);assert.equal(result.branch_fees.main.department_id,'dept');assert.equal(original.consultation_fee,'700');
  assert.equal(increasedDoctorFees(null).consultation_fee,100);assert.equal(increasedDoctorFees({consultation_fee:0}).consultation_fee,100);assert.equal(increasedDoctorFees({consultation_fee:'650.50'}).consultation_fee,750.5);
  assert.throws(()=>increasedDoctorFees({consultation_fee:'invalid'}),/Invalid/);
});

test('backs up and verifies all doctors in a transaction and never applies the same increase twice',async()=>{
  const doctors=[{id:'a',tenant_id:'hospital',professional:{consultation_fee:500}},{id:'b',tenant_id:'hospital',professional:{consultation_fee:700,branch_fees:{main:{consultation_fee:800}}}}];
  const original=structuredClone(doctors);let summary:any=null,updates=0,backup:any=null;
  const client:any={query:async(sql:string,args:any[]=[])=>{
    if(sql.startsWith('SELECT summary'))return {rows:summary?[{summary}]:[]};
    if(sql.startsWith('SELECT id'))return {rows:structuredClone(doctors)};
    if(sql.startsWith('UPDATE staff_members')){updates++;const doctor=doctors.find(row=>row.id===args[1])!;doctor.professional=args[0];return {rows:[{professional:args[0]}]};}
    if(sql.startsWith('INSERT INTO doctor_fee_adjustment_runs')){backup=JSON.parse(args[1]);summary=args[2];}
    return {rows:[]};
  }};
  const result=await increaseAllDoctorFees(client);assert.equal(result.doctors_updated,2);assert.equal(result.already_applied,false);assert.deepEqual(backup,original);
  assert.equal(doctors[0].professional.consultation_fee,600);assert.equal(doctors[1].professional.branch_fees?.main.consultation_fee,900);
  assert.equal((await increaseAllDoctorFees(client)).already_applied,true);assert.equal(updates,2);
});

test('an invalid existing fee rolls back without writing any doctor fees',async()=>{
  const calls:string[]=[];const client:any={query:async(sql:string)=>{calls.push(sql);return {rows:sql.startsWith('SELECT id')?[{id:'bad',professional:{consultation_fee:'bad'}}]:[]};}};
  await assert.rejects(increaseAllDoctorFees(client),/Invalid/);assert.equal(calls.at(-1),'ROLLBACK');assert.ok(!calls.some(sql=>sql.startsWith('UPDATE')));
});
