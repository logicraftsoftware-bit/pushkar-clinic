import { inspectLabBackup, legacyUuid, csvNumber, legacyTimestamp, readLegacyCsv, type LegacyRow } from "./lab-csv.js";
import { laboratoryReference } from "./lab-clinical.js";

type Row = Record<string, any>;
export type LabImportPlan = {version:1;tenant_id:string;branch_id:string;summary:Row;masters:Row[];patients:Row[];orders:Row[];invoices:Row[];legacy:Row[]};
function index(rows: LegacyRow[], key: (row: LegacyRow) => string | undefined) {
  const map = new Map<string, LegacyRow[]>();
  for (const row of rows) {const id=key(row);if(id===undefined)throw new Error("Missing CSV grouping key");map.set(id,[...(map.get(id)||[]),row]);}
  return map;
}
const groupKey = (row: LegacyRow) => [row.patient_id,row.opd_id,row.ipd_id||"0",row.batch_no||"0"].join("|");
const zero = (value: string | undefined) => !value || value === "0";
export function buildLabImportPlan(directory: string, tenant: string, branch: string): LabImportPlan {
  const source=inspectLabBackup(directory), t=source.tables;
  const uuid=(kind:string,id:string)=>legacyUuid(tenant,kind,id);
  const masters:Row[]=[], names=new Set<string>();
  function add(kind:string,id:string|undefined,name:string|undefined,data:Row) {
    if(!id)throw new Error(`Missing ${kind} identifier`);
    let display=name?.trim()||`Legacy ${kind} ${id}`;
    if(names.has(`${kind}|${display.toLowerCase()}`))display+=` [${id}]`;
    names.add(`${kind}|${display.toLowerCase()}`);
    masters.push({id:uuid(kind,id),kind,name:display,data:{...data,legacy_id:id,import_source:"talentbook-csv"}});
  }
  const definitions=new Map(t.Parameter_old!.map(row=>[row.ID,row]));
  const requiredParameterIds=new Set([...source.parameterIds,...source.results.map(row=>row.paramid)].filter((id):id is string=>!!id));
  const units=new Map(t.Units!.map(row=>[row.ID,row]));
  const samples=new Map(t.Sample!.map(row=>[row.ID,row]));
  const containers=new Map(t.vaccu_master!.map(row=>[row.id,row]));
  const methods=new Map(t.test_methods!.map(row=>[row.id,row]));
  const resultTypes=new Map(t.ResultType!.map(row=>[row.ResultTypeId,row.ResultType_name]));
  const choices=new Map(t.Options!.map(row=>[row.id,row.name]));
  const optionGroups=index(t.ResultOptions!,row=>row.id);
  const ranges=index(t.parameter_normal_check!,row=>row.parameter_id);
  const formulas=new Map(t.parameter_formula!.map(row=>[row.ParameterID,row]));
  const departmentRows=t.test_department!.filter(row=>row.category_id==="1");
  for(const row of departmentRows)add("category",row.id,row.name,{legacy:row});
  add("category","unassigned","Unassigned laboratory department",{});
  const unitIds=new Set<string>(),sampleIds=new Set<string>(),containerIds=new Set<string>(),methodIds=new Set<string>();
  for(const id of requiredParameterIds){const row=definitions.get(id);if(row){unitIds.add(row.UnitsID!);sampleIds.add(row.sample!);containerIds.add(row.vaccu!);methodIds.add(row.method!);}}
  const testSamples=index(t.TestSample!,row=>row.TestId),testContainers=index(t.test_vaccu!,row=>row.testid),testParameters=index(source.links,row=>row.TestId),subTests=index(t.testmaster_sub!,row=>row.testid);
  for(const row of source.pathology){for(const sample of testSamples.get(row.testid!)||[])sampleIds.add(sample.SampleId!);for(const container of testContainers.get(row.testid!)||[])containerIds.add(container.vac_id!);}
  for(const id of unitIds){const row=units.get(id);if(row)add("unit",id,row.unit_name!,{legacy:row});}
  for(const id of sampleIds){const row=samples.get(id);if(row)add("specimen",id,row.Name!,{legacy:row});}
  for(const id of containerIds){const row=containers.get(id);if(row)add("container",id,row.type!,{amount:csvNumber(row.rate,"container rate"),barcode_suffix:row.barcode_suffix,legacy:row});}
  for(const id of methodIds){const row=methods.get(id);if(row)add("method",id,row.name!,{legacy:row});}
  for(const id of requiredParameterIds){
    const row=definitions.get(id),formula=formulas.get(id);
    add("parameter",id,row?.Name||`Legacy parameter ${id} (definition unavailable)`,{
      unit_id:row&&units.has(row.UnitsID!)?uuid("unit",row.UnitsID!):null,
      result_type:resultTypes.get(row?.ResultType||"")||"One Line Text",result_type_id:row?.ResultType||"3",
      choices:(optionGroups.get(row?.ResultOptionID||"")||[]).map(option=>choices.get(option.optionid!)||"").filter(Boolean),
      normal_ranges:ranges.get(id)||[],formula:formula?.formula||"",decimals:formula?.res_dec||row?.deci_val||"",
      specimen_id:row&&samples.has(row.sample!)?uuid("specimen",row.sample!):null,
      container_id:row&&containers.has(row.vaccu!)?uuid("container",row.vaccu!):null,
      method:row?methods.get(row.method!)?.name||"":"",description:row?.sub_title||"",instrument:row?.instrument||"",
      missing_definition:!row,legacy:row||{ID:id},
    });
  }
  const fixed=index(t.param_fix_result!,row=>row.testid);
  const summary=index(t.test_summary!,row=>row.testid);
  function expandedParameters(id:string,seen=new Set<string>()):string[]{
    if(seen.has(id))return [];seen.add(id);
    const direct=(testParameters.get(id)||[]).sort((a,b)=>Number(a.sequence)-Number(b.sequence)).map(link=>uuid("parameter",link.ParamaterId!));
    return [...new Set([...direct,...(subTests.get(id)||[]).filter(link=>source.testIds.has(link.sub_testid!)).flatMap(link=>expandedParameters(link.sub_testid!,seen))])];
  }
  for(const row of source.pathology){
    const links=(testParameters.get(row.testid!)||[]).sort((a,b)=>Number(a.sequence)-Number(b.sequence));
    add("test",row.testid!,row.testname!,{
      short_name:row.testid,amount:csvNumber(row.rate,"test rate"),standard_charge:csvNumber(row.rate,"test rate"),
      legacy_branch_rates:{aditya:row.rate_aditya,bgarh:row.rate_bgarh,lakhimpur:row.rate_lakhimpur},
      category_id:uuid("category",departmentRows.some(dep=>dep.id===row.type_id)?row.type_id!:"unassigned"),
      parameter_ids:expandedParameters(row.testid!),parameter_links:links,
      specimen_ids:(testSamples.get(row.testid!)||[]).filter(link=>samples.has(link.SampleId!)).map(link=>uuid("specimen",link.SampleId!)),
      container_ids:(testContainers.get(row.testid!)||[]).filter(link=>containers.has(link.vac_id!)).map(link=>uuid("container",link.vac_id!)),
      sub_test_ids:(subTests.get(row.testid!)||[]).filter(link=>source.testIds.has(link.sub_testid!)).map(link=>uuid("test",link.sub_testid!)),
      instruction:row.instruction,notes:row.notes,report_delivery:row.report_delivery,description:row.sample_details,
      equipment:row.equipment,sex:row.sex,report_order:row.lineno,container_charge:row.vac_charge,
      summaries:summary.get(row.testid!)||[],fixed_results:fixed.get(row.testid!)||[],
      import_issues:links.filter(link=>!definitions.has(link.ParamaterId!)).map(link=>`Missing parameter definition ${link.ParamaterId}`),legacy:row,
    });
  }
  for(const row of t.lab_doctor!){const {password:_password,...safe}=row;add("approver",row.id!,row.name!,{designation:row.desig,qualification:row.qual,registration_number:row.regd_no,signature_name:row.sign_name,legacy:safe});}
  const history=index(source.history,groupKey),resultIndex=index(source.results,groupKey);
  const sampleIndex=index(t.phlebo_sample!.filter(row=>source.testIds.has(row.testid!)),groupKey);
  const visits=index(t.uhid_and_opdid!,row=>`${row.patient_id}|${row.opd_id}`);
  const paymentRows=readLegacyCsv(directory,"payment_detail_all");
  const payments=index(paymentRows,row=>`${row.patient_id}|${row.opd_id}`);
  const patientMap=new Map(t.patient_info!.map(row=>[row.patient_id,row]));
  for(const row of readLegacyCsv(directory,"patient_info_edit"))if(!patientMap.has(row.patient_id))patientMap.set(row.patient_id,row);
  const groups=new Set([...history.keys(),...resultIndex.keys(),...sampleIndex.keys()]);
  const testById=new Map(source.pathology.map(row=>[row.testid,row]));
  const orders:Row[]=[],labPatientIds=new Set<string>();
  for(const key of groups){
    const details=history.get(key)||[],results=resultIndex.get(key)||[],collected=sampleIndex.get(key)||[];
    const first=details[0]||results[0]||collected[0]!;
    labPatientIds.add(first.patient_id!);
    const patient=patientMap.get(first.patient_id),visit=visits.get(`${first.patient_id}|${first.opd_id}`)?.[0];
    const timestamps=[...details,...results,...collected].map(row=>legacyTimestamp(row.date!,row.time)).filter((value):value is string=>!!value).sort();
    const orderedIds=[...new Set([...details,...results,...collected].map(row=>row.testid!))];
    const savedResults=orderedIds.map(id=>({test_id:uuid("test",id),test_name:testById.get(id)?.testname||`Legacy test ${id}`,parameters:results.filter(row=>row.testid===id).sort((a,b)=>Number(a.sequence)-Number(b.sequence)).map(row=>{
      const parameter=definitions.get(row.paramid!);
      return {parameter_id:uuid("parameter",row.paramid!),name:parameter?.Name||`Legacy parameter ${row.paramid}`,value:row.result||"",remarks:"",unit:units.get(parameter?.UnitsID||"")?.unit_name||"",description:parameter?.sub_title||"",...laboratoryReference(ranges.get(row.paramid!)||[],patient?.sex||"",null,row.range_id),legacy:row};
    })}));
    const hasResults=results.length>0,technicianApproved=hasResults&&results.every(row=>!zero(row.main_tech)),doctorApproved=technicianApproved&&results.every(row=>!zero(row.doc));
    orders.push({id:uuid("order",key),legacy_patient_id:first.patient_id,uhid:patient?.uhid||null,patient_source:patient||null,
      kind:hasResults?"results":collected.length?"sample collection":"orders",status:doctorApproved?"Doctor Approved":technicianApproved?"Technician Approved":hasResults?"Awaiting Verification":collected.length?"Collected":"Pending",
      occurred_at:timestamps[0]||null,legacy_center:visit?.center_no||patient?.center_no||null,
      data:{legacy_key:key,legacy_patient_id:first.patient_id,legacy_opd_id:first.opd_id,legacy_ipd_id:first.ipd_id,legacy_batch_no:first.batch_no,
        customer_name:patient?.name||`Unlinked legacy patient ${first.patient_id}`,medical_record_number:patient?.uhid||"",patient_type:!zero(first.ipd_id)?"IPD":"OPD",phone:patient?.phone||"",gender:patient?.sex||"",age:patient?.age||"",
        tests:orderedIds.map(id=>{const detail=details.filter(row=>row.testid===id);return {test_id:uuid("test",id),name:testById.get(id)?.testname||`Legacy test ${id}`,priority:"Routine",amount:detail.reduce((sum,row)=>sum+csvNumber(row.test_rate,"historical test rate"),0),legacy_test_discount:detail.reduce((sum,row)=>sum+csvNumber(row.test_discount,"historical test discount"),0),legacy_details:detail};}),
        lab_results:savedResults,result_status:hasResults?"Completed":"Pending",collected_at:collected.length?legacyTimestamp(collected[0]!.date!,collected[0]!.time):hasResults?timestamps[0]:null,
        result_completed_at:hasResults?timestamps[timestamps.length-1]:null,technician_approval:technicianApproved?{legacy:true,staff_ids:[...new Set(results.map(row=>row.main_tech))]}:null,
        doctor_approval:doctorApproved?{legacy:true,staff_ids:[...new Set(results.map(row=>row.doc))]}:null,
        sample_records:collected,legacy_payments:payments.get(`${first.patient_id}|${first.opd_id}`)||[],
        import_source:"talentbook-csv",billing_review_required:true,unlinked_patient:!patient,missing_order_details:!details.length,invalid_source_timestamp:!timestamps.length,
      }});
  }
  const patients=[...labPatientIds].filter(id=>patientMap.has(id)).map(id=>({id:uuid("patient",id),legacy_id:id,source:patientMap.get(id)}));
  const allVisits=index(t.patient_test_details!,row=>`${row.patient_id}|${row.opd_id}`),orderVisits=new Map<string,Row[]>();
  for(const order of orders){const key=`${order.legacy_patient_id}|${order.data.legacy_opd_id}`;orderVisits.set(key,[...(orderVisits.get(key)||[]),order]);}
  const invoices:Row[]=[];
  for(const payment of t.invest_patient_payment_details!){
    const key=`${payment.patient_id}|${payment.opd_id}`,visitTests=allVisits.get(key)||[],linked=orderVisits.get(key)||[];
    if(!linked.length||!visitTests.length||visitTests.some(test=>!source.testIds.has(test.testid!)))continue;
    const gross=csvNumber(payment.tot_amount,"bill total"),discount=csvNumber(payment.dis_amt,"bill discount"),tax=csvNumber(payment.tax_amount,"bill tax"),refund=csvNumber(payment.refund_amount,"bill refund"),advance=csvNumber(payment.advance,"bill payments"),due=csvNumber(payment.balance,"bill balance");
    const total=Math.round((gross-discount+tax)*100)/100,paid=Math.round((advance-refund)*100)/100;
    const testGross=visitTests.reduce((sum,test)=>sum+csvNumber(test.test_rate,"bill test rate"),0);
    if(Math.abs(testGross-gross)>.02||Math.abs(total-paid-due)>.02||Math.min(gross,discount,tax,total,paid,due)<0||discount>gross)continue;
    const id=uuid("invoice",key),number=`LAB-LEGACY-${payment.patient_id}-${payment.opd_id}`;
    invoices.push({id,record_number:number,legacy_patient_id:payment.patient_id,order_ids:linked.map(order=>order.id),amount:gross,total,paid,due,status:due===0?"Paid":paid>0?"Partially Paid":"Unpaid",record_date:legacyTimestamp(payment.date!,payment.time)?.slice(0,10)||linked[0]!.occurred_at.slice(0,10),data:{source:"Laboratory",import_source:"talentbook-csv",read_only:true,lab_order_id:linked[0]!.id,legacy:payment,tax_amount:tax,discount_amount:discount,refund_amount:refund,original_payments:advance,tests:linked.flatMap(order=>order.data.tests)}});
    for(const order of linked){Object.assign(order.data,{bill_id:id,bill_number:number,billing_review_required:false,discount_amount:discount,paid_amount:paid,due_amount:due});if(order.kind==="orders"){order.kind="pos";order.status=due===0?"Paid":paid>0?"Partially Paid":"Awaiting Payment";}}
  }
  const legacy:Row[]=[];
  for(const name of ["patient_test_details_cancel","patient_test_details_delete","patient_test_details_edit","testresults_cancel","testresults_update","patient_test_summary","testreport_print"]){
    for(const [position,row] of t[name]!.entries())if(source.testIds.has(row.testid!))legacy.push({table:name,key:`${row.slno||"row"}:${position}`,data:row});
  }
  return {version:1,tenant_id:tenant,branch_id:branch,masters,patients,orders,invoices,legacy,summary:{...source.summary,orders:orders.length,verified_invoices:invoices.length,billing_review_orders:orders.filter(order=>order.data.billing_review_required).length,patients_with_definitions:patients.length,unlinked_patient_ids:[...labPatientIds].filter(id=>!patientMap.has(id)),missing_order_details:orders.filter(row=>row.data.missing_order_details).length,invalid_source_timestamps:orders.filter(row=>!row.occurred_at).length,financial_import:"Verified lab-only bills imported; original mixed investigation/payment data retained for reconciliation without guessed allocation",audit_rows:legacy.length}};
}
