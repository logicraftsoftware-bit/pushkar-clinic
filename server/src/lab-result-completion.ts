import {reportParameters} from './lab-report-parameters.js';
type Row = Record<string, any>;

export function defaultLabNumericResults(tests: Row[], data: Row): Row[] {
  const locked = new Set(lockedLabTestIds(data));
  return tests.map(test => locked.has(test.test_id) ? test : {
    ...test,
    parameters: test.parameters.map((parameter: Row) =>
      String(parameter.result_type_id) === "1" && !parameter.formula && !String(parameter.value ?? "").trim()
        ? {...parameter, value: "0"}
        : parameter),
  });
}

export function labTestComplete(test: Row): boolean {
  const parameters: Row[] = Array.isArray(test.parameters) ? test.parameters : [];
  const required = parameters.filter(p => !["0", "5"].includes(String(p.result_type_id)));
  return required.length > 0 && required.every(p => String(p.value ?? "").trim() !== "");
}

export function labTestHasResults(test: Row): boolean {
  return (test.parameters ?? []).some((parameter:Row) =>
    !["0","5"].includes(String(parameter.result_type_id)) && String(parameter.value ?? "").trim() !== "");
}

export function labResultProgress(tests: Row[]) {
  const completed = tests.filter(labTestComplete);
  const started = tests.some(labTestHasResults);
  return {completed, status: tests.length > 0 && completed.length === tests.length ? "Completed" : started ? "Partially Completed" : "In Progress"};
}

export function labTestResultStatus(test: Row): string {
  const status = labResultProgress([test]).status;
  return status === "In Progress" ? "Pending" : status;
}

export function labOrderEditable(order: Row): boolean {
  return ["orders", "pos"].includes(String(order.kind).toLowerCase()) &&
    !["Cancelled", "Rejected"].includes(order.status) &&
    !order.data?.sample_requested_at && !order.data?.collected_at &&
    !order.data?.barcodes?.length && !order.data?.import_source;
}

export function approvedLabTestIds(data: Row): string[] {
  if (!data.doctor_approval) return [];
  return data.doctor_approval.test_ids ?? (data.lab_results ?? []).filter(labTestHasResults).map((test: Row) => test.test_id);
}

export function reportableLabTests(tests: Row[], data: Row): Row[] {
  const approved = new Set(approvedLabTestIds(data));
  return tests.filter(test => reportParameters(test).length>0 && approved.has(test.test_id));
}

export function technicianLabTestIds(data:Row):string[]{
  return data.technician_approval?.test_ids ?? [];
}
export function lockedLabTestIds(data:Row):string[]{return approvedLabTestIds(data);}

export function resultEntryForTest(data:Row,testId:unknown):Row|undefined{
  const id=String(testId),direct=data.result_entry?.tests?.[id];
  if(direct)return direct;
  const history=[...(data.result_history||[])].reverse().find((entry:Row)=>entry.changes?.some((change:Row)=>String(change.test_id)===id));
  if(history?.by)return {by:history.by,name:data.result_entry_names?.[history.by]||'',at:history.at};
  const old=data.technician_approval?.tests?.[id]||(technicianLabTestIds(data).includes(id)?data.technician_approval:undefined);
  if(old)return old;
  if(data.result_completed_by)return {by:data.result_completed_by,name:data.result_entry_names?.[data.result_completed_by]||'',at:data.result_completed_at};
}
