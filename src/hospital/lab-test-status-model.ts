export type TestStatusRow={order_id:string;test_id:string;test_name:string;report_date:string;registered_at:string;uhid:string;patient_name:string;bill_number:string;barcode:string;result_status:string;group_total?:number};
export function groupTestStatusRows(rows:TestStatusRow[]){
  const groups=new Map<string,{date:string;test:string;rows:TestStatusRow[]}>();
  for(const row of rows){
    const key=`${row.report_date}:${row.test_id}`;
    const group=groups.get(key)??{date:row.report_date,test:row.test_name,rows:[]};
    group.rows.push(row);groups.set(key,group);
  }
  return [...groups.values()];
}
export const reportRegistrationTime=(value:string)=>new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',second:'2-digit'});
export const reportStatusLabel=(status:string)=>status==='Completed'?'Done':status;
const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]!);
export function testStatusPrintHtml(rows:TestStatusRow[],from:string,to:string,filter:string,printedAt=new Date()){
  const body=groupTestStatusRows(rows).map(group=>`<tbody><tr class="group"><th colspan="7">Date: ${escape(group.date)} · ${escape(group.test)} (Total: ${group.rows.length})</th></tr>${group.rows.map((row,index)=>`<tr><td>${index+1}</td><td>${escape(row.uhid||'—')}</td><td>${escape(row.bill_number||'—')}</td><td>${escape(row.barcode||'—')}</td><td>${escape(row.patient_name)}</td><td>${escape(reportRegistrationTime(row.registered_at))}</td><td>${escape(reportStatusLabel(row.result_status))}</td></tr>`).join('')}</tbody>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Laboratory Test Status Report</title><style>@page{size:A4 landscape;margin:12mm}body{font:12px Arial;color:#15253b}h1{font-size:20px}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #ddd}thead{display:table-header-group;background:#eef2f8}.group{background:#f5f7fb}tr{break-inside:avoid}footer{margin-top:18px;color:#53647a}</style></head><body><h1>Laboratory Test Status Report</h1><p>${escape(from)} to ${escape(to)} · ${escape(filter)} · ${rows.length} tests</p><p>Printed: ${escape(printedAt.toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}))}</p><table><thead><tr><th>#</th><th>UHID</th><th>Bill No</th><th>Barcode IDs</th><th>Patient Name</th><th>Reg Time</th><th>Status</th></tr></thead>${body}</table><footer>Done = all test results saved. Partially completed tests remain pending. This is an operational status report.</footer><script>window.onload=()=>{window.focus();window.print()}<\/script></body></html>`;
}
