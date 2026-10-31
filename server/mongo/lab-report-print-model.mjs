import {labTestComplete,labTestHasResults,reportableLabTests} from './lab-result-completion.mjs';

export const reportPrintRevisionSql="md5(jsonb_build_object('tests',w.data->'tests','results',w.data->'lab_results','narrative',w.data->'report_narrative','approval',w.data->'doctor_approval','technician',w.data->'technician_approval','entry',w.data->'result_entry')::text)";
export function reportPrintTestKey(test    ,index       ){return String(test.test_id||`index:${index}`);}
export function savedPrintableKeys(data    ){
  const results      =data.lab_results||[];
  return (data.tests||[]).flatMap((ordered    ,index       )=>{
    const saved=ordered.test_id?results.find(row=>String(row.test_id)===String(ordered.test_id)):results[index];
    const test={...ordered,...saved,test_id:ordered.test_id||null};
    return saved&&reportableLabTests([test],data).length?[reportPrintTestKey(ordered,index)]:[];
  });
}
export function reportPrintStatus(test    ,index       ,record    ,events      ){
  const data=record.data||{},key=reportPrintTestKey(test,index);
  const approved=(approval              )=>Boolean(approval)&&(!Array.isArray(approval?.test_ids)||approval.test_ids.map(String).includes(String(test.test_id)));
  const event=record.report_revision?events.find(event=>event.revision===record.report_revision&&event.test_ids?.includes(key)):undefined;
  return {sample:Boolean(data.collected_at),entered:labTestComplete(test),technician:labTestHasResults(test),doctor:approved(data.doctor_approval),printed:Boolean(event),event};
}
