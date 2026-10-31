import {labTestHasResults,approvedLabTestIds,technicianLabTestIds} from './lab-result-completion.mjs';

export function verifyLabTests(data    ,stage                      ,ids         ,actor    ,perTest                   ={}){
  if(!ids.length)throw Error('Select at least one test to verify');
  const eligible=new Set((data.lab_results||[]).filter(labTestHasResults).map((test    )=>test.test_id));
  if(ids.some(id=>!eligible.has(id)))throw Error('Only completed or partially completed tests with saved results can be verified');
  const key=stage==='doctor'?'doctor_approval':'technician_approval';
  const previous=stage==='doctor'?approvedLabTestIds(data):technicianLabTestIds(data);
  if(ids.some(id=>previous.includes(id)))throw Error('One or more selected tests are already verified');
  const prior=data[key]||{};
  const metadata    ={...actor,test_ids:[...new Set([...previous,...ids])],tests:{...prior.tests,...Object.fromEntries(ids.map(id=>[id,perTest[id]||actor]))}};
  if(stage==='doctor'){
    metadata.pathologist_ids=[...new Set([...(prior.pathologist_ids||[]),...(actor.pathologist_ids||[])])];
    metadata.pathologist_names=[...new Set([...(prior.pathologist_names||[]),...(actor.pathologist_names||[])])];
  }
  return {[key]:metadata,...(stage==='doctor'?{disapproved_test_ids:(data.disapproved_test_ids||[]).filter((id       )=>!ids.includes(id))}:{})};
}

export function disapproveLabTests(data    ,ids         ){
  const approved=approvedLabTestIds(data);
  if(!ids.length||new Set(ids).size!==ids.length)throw Error('Select tests to disapprove');
  if(ids.some(id=>!approved.includes(id)))throw Error('Only doctor-approved tests can be disapproved');
  const remaining=approved.filter(id=>!ids.includes(id));
  const tests=Object.fromEntries(Object.entries(data.doctor_approval?.tests||{}).filter(([id])=>!ids.includes(id)));
  return {doctor_approval:remaining.length?{...data.doctor_approval,test_ids:remaining,tests}:null,disapproved_test_ids:[...new Set([...(data.disapproved_test_ids||[]),...ids])]};
}
