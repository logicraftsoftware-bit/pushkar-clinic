type Row=Record<string,any>;
const pendingStatuses=['Pending','Awaiting Payment','Paid','Partially Paid','Unpaid','Payment not required','Awaiting Sample'];
// Listing an order in the queue does not start collection or prevent edits.
export function awaitingLabSample(row:Row):boolean{
  const data=row.data||{};
  return row.workspace==='laboratory'&&['orders','pos','sample collection'].includes(String(row.kind).toLowerCase())&&
    pendingStatuses.includes(row.status)&&!data.import_source&&!data.read_only&&!data.cancellation_request_id&&
    !data.collected_at&&!data.barcodes?.length&&!data.processing_status&&
    (!data.result_status||data.result_status==='Pending')&&Array.isArray(data.tests)&&data.tests.length>0;
}
export function sampleCollectionRow(row:Row):Row{
  return awaitingLabSample(row)?{...row,status:'Awaiting Sample'}:row;
}
export function inLabSampleQueue(row:Row):boolean{
  return awaitingLabSample(row)||(row.workspace==='laboratory'&&row.kind==='sample collection'&&row.status==='Barcode Generated'&&!row.data?.collected_at&&!row.data?.cancellation_request_id);
}
// Uses the same eligibility as the client and barcode action, before pagination.
export const awaitingLabSampleSql=`(lower(w.kind) IN ('orders','pos','sample collection')
  AND w.status IN ('Pending','Awaiting Payment','Paid','Partially Paid','Unpaid','Payment not required','Awaiting Sample')
  AND nullif(w.data->>'import_source','') IS NULL AND coalesce(w.data->>'read_only','false')<>'true'
  AND nullif(w.data->>'cancellation_request_id','') IS NULL AND nullif(w.data->>'collected_at','') IS NULL
  AND coalesce(w.data->'barcodes','[]'::jsonb)='[]'::jsonb AND coalesce(w.data->>'processing_status','')=''
  AND coalesce(w.data->>'result_status','') IN ('','Pending')
  AND CASE WHEN jsonb_typeof(w.data->'tests')='array' THEN jsonb_array_length(w.data->'tests')>0 ELSE false END)`;
export const labSampleQueueSql=`(${awaitingLabSampleSql} OR (lower(w.kind)='sample collection' AND w.status='Barcode Generated' AND nullif(w.data->>'collected_at','') IS NULL AND nullif(w.data->>'cancellation_request_id','') IS NULL))`;
