export type FinanceRecord = Record<string, any>;
export type AccountingReport = "receipts" | "discounts" | "refunds" | "balance-received" | "balance";
export type AccountingFilters = {from:string;to:string;department:string;user:string;encounter:string;status:string;entryType:string;paymentMethod:string;query:string;branch?:string;doctors?:string[]};
export function accountingEncounterGroup(value:string){
  return ['Laboratory','Radiology','Laboratory & Radiology'].includes(value)?'Laboratory & Radiology':value;
}
export function accountingPaymentMethod(value:unknown){
  const method=String(value??'').trim().replace(/\s+/g,' '),key=method.toLowerCase();
  return ({cash:'Cash',upi:'UPI',card:'Card','credit card':'Credit Card','debit card':'Debit Card','bank transfer':'Bank Transfer',neft:'NEFT',rtgs:'RTGS',cheque:'Cheque',check:'Cheque',online:'Online'} as Record<string,string>)[key]||method||'Unspecified';
}
const transactionTimeFormatter=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hour12:true});
export function accountingTransactionTime(row:FinanceRecord):string {
  if(row.data?.legacy_receipt&&row.data?.date_basis==='appointment_date')return '';
  const timestamp=String(row.created_at||'');
  if(!/[T ]\d{2}:\d{2}/.test(timestamp))return '';
  const date=new Date(timestamp);
  return Number.isNaN(date.getTime())?'':transactionTimeFormatter.format(date);
}
const amount=(value:unknown)=>Math.round((Number(value)||0)*100)/100;
// Laboratory orders store a display name in referred_by, separately from its ID.
function referringDoctorName(data:FinanceRecord|undefined){
  for(const value of [data?.referred_by,data?.referred_by_name,data?.referring_doctor_name,data?.doctor_name]){
    if(typeof value!=='string')continue;
    const name=value.trim();
    if(!name||name==='\u2014'||name==='-'||/^\d+$/.test(name)||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name))continue;
    return name;
  }
  return '';
}
export function accountingRecord(row:FinanceRecord):FinanceRecord {
  const data={...row.accounting_lab_data,...row.invoice_data,...row.data};
  const source=[row.accounting_lab_data?.source,row.invoice_data?.source,row.data?.source,data.care_type].filter(Boolean).join(' ').toLowerCase();
  const labOrderId=row.data?.lab_order_id||row.invoice_data?.lab_order_id||row.accounting_lab_data?.lab_order_id;
  const encounter=/lab/.test(source)||labOrderId?"Laboratory":/radiolog/.test(source)?"Radiology":row.kind==='pharmacy-bill'||/pharmacy/.test(source)?"Pharmacy":row.accounting_encounter||(data.admission_id||/ipd/.test(source)?"IPD":data.appointment_id||/opd/.test(source)?"OPD":data.care_type||"Other");
  const laboratory=['Laboratory','Radiology'].includes(encounter);
  const labDoctor=laboratory?(referringDoctorName(row.accounting_lab_data)||referringDoctorName(row.invoice_data)||referringDoctorName(row.data)):'';
  const labDoctorId=laboratory?(row.accounting_lab_data?.referred_by_id||row.invoice_data?.referred_by_id||row.data?.referred_by_id):'';
  const discount=amount(data.discount_amount??data.discount??(Number(data.registration_discount||0)+Number(data.admission_discount||0)));
  // Use fees on this bill/appointment, never the patient's previous registration.
  const charges:FinanceRecord[]=Array.isArray(row.accounting_appointment_charges)?row.accounting_appointment_charges:Array.isArray(data.charges)?data.charges:[];
  const chargeTotal=(pattern:RegExp)=>charges.filter(charge=>pattern.test(String(charge.label||charge.name||charge.type||''))).reduce((sum,charge)=>sum+Number(charge.amount??charge.price??0),0);
  const opdAmount=encounter==='OPD'?amount(data.consultation_fee??row.accounting_opd_amount??0):0;
  const doctorFeeSnapshot=encounter==='OPD'&&charges.some(charge=>charge.fee_snapshot_version===2&&charge.doctor_fee);
  const savedDoctorFee=(key:string)=>amount(charges.filter(charge=>charge.doctor_fee===key).reduce((sum,charge)=>sum+Number(charge.amount||0),0));
  const registrationAmount=doctorFeeSnapshot?savedDoctorFee('registration_fee'):amount(data.registration_fee??data.registration_fee_amount??(encounter==='OPD'?chargeTotal(/registrat/i):0));
  const maintenanceAmount=doctorFeeSnapshot?savedDoctorFee('maintenance_fee'):amount(data.maintenance_fee??data.maintenance_amount??(encounter==='OPD'?chargeTotal(/maint(?:enance|ainance|anance)/i):0));
  return {...row,transactionTime:accountingTransactionTime(row),metadata:data,encounter,department:row.accounting_department_name||data.department_name||(["Laboratory","Radiology","Pharmacy"].includes(encounter)?encounter:"Unassigned"),
    opdAmount,registrationAmount,maintenanceAmount,
    patientPhone:String(row.patient_phone||data.patient_phone||data.phone||"").trim(),
    user:row.created_by_name?.trim()||data.collected_by_name||"Unassigned",patient:row.patient_name?.trim()||data.customer_name||data.patient_name||"Walk-in",
    bill:row.invoice_number||data.bill_number||row.appointment_number||data.appointment_number||row.record_number,
    transaction:data.transaction_reference||data.payment_reference||row.record_number,
    doctorId:labDoctorId||row.accounting_doctor_id||data.doctor_id||'',
    doctor:labDoctor||row.accounting_doctor_name||data.referred_by_name||data.referring_doctor_name||data.doctor_name||referringDoctorName(data)||"\u2014",
    method:accountingPaymentMethod(data.payment_method||data.payment_mode),
    entryType:encounter==="Pharmacy"?"Pharmacy":"Medical",
    visitType:row.accounting_visit_type||data.visit_type||"Unspecified",
    referPharmacy:data.refer_pharmacy_name||'Not Applicable',
    pharmacyDiscountPercentage:amount(data.pharmacy_discount_percentage),
    pharmacyDiscount:amount(data.pharmacy_discount_amount),
    grossBill:amount(row.kind==='invoices'?row.amount:row.accounting_invoice_amount??data.tests?.reduce((sum:number,test:FinanceRecord)=>sum+Number(test.amount||0),0)),
    netBill:amount(row.kind==='invoices'?row.total:row.accounting_invoice_total??data.invoice_total??(Number(data.tests?.reduce((sum:number,test:FinanceRecord)=>sum+Number(test.amount||0),0)||0)-discount)),
    discount,receipt:row.kind==='payments'?amount(row.amount):0,
    refund:row.kind==='refunds'?amount(row.amount):0,
    balance:row.kind==='invoices'||row.kind==='pharmacy-bill'?amount(row.due):0,
    isBalancePayment:row.kind==='payments'&&(row.accounting_is_balance_payment===true||/balance/i.test(String(data.payment_type||""))||(!!row.invoice_record_date&&String(row.record_date).slice(0,10)>String(row.invoice_record_date).slice(0,10)))};
}
export function filterAccounting(rows:FinanceRecord[],filters:AccountingFilters){
  const query=filters.query.trim().toLowerCase();
  return rows.filter(row=>{
    const day=String(row.record_date||"").slice(0,10);
    return (!filters.from||day>=filters.from)&&(!filters.to||day<=filters.to)&&(!filters.branch||String(row.branch_id||row.branch_name)===filters.branch)&&(filters.encounter!=='OPD'||!filters.doctors?.length||filters.doctors.includes(String(row.doctorId||row.doctor)))&&(!filters.department||row.department===filters.department)&&(!filters.user||String(row.created_by||row.user)===filters.user)&&(!filters.encounter||accountingEncounterGroup(row.encounter)===accountingEncounterGroup(filters.encounter))&&(!filters.status||row.status===filters.status||row.visitType===filters.status)&&(!filters.entryType||row.entryType===filters.entryType)&&(!filters.paymentMethod||row.method===filters.paymentMethod)&&(!query||[row.bill,row.transaction,row.patient,row.patientPhone,row.medical_record_number,row.user,row.doctor,row.branch_name,row.referPharmacy].join(' ').toLowerCase().includes(query));
  });
}
export function accountingReportRows(rows:FinanceRecord[],report:AccountingReport):FinanceRecord[]{
  if(report==='receipts')return rows.filter(row=>row.kind==='payments').map(row=>({...row,reportAmount:row.receipt}));
  if(report==='refunds')return rows.filter(row=>row.kind==='refunds').map(row=>({...row,reportAmount:row.refund}));
  if(report==='balance')return rows.filter(row=>row.balance>0).map(row=>({...row,reportAmount:row.balance}));
  if(report==='balance-received')return rows.filter(row=>row.isBalancePayment).map(row=>({...row,reportAmount:row.receipt}));
  const invoiceAppointments=new Set(rows.filter(row=>['invoices','pharmacy-bill'].includes(row.kind)).map(row=>row.metadata.appointment_id).filter(Boolean));
  const seen=new Set<string>();
  return rows.flatMap(row=>{
    const invoice=['invoices','pharmacy-bill'].includes(row.kind),appointment=row.metadata.appointment_id;
    const key=invoice?row.id:`appointment:${appointment}`;
    const value=invoice?row.discount:amount(row.accounting_appointment_discount);
    if(!invoice&&(row.kind!=='payments'||!appointment||invoiceAppointments.has(appointment)))return [];
    if(value<=0||seen.has(key))return [];
    seen.add(key);return [{...row,reportAmount:value}];
  });
}
export function accountingTotals(rows:FinanceRecord[]){
  return Object.fromEntries((['receipts','discounts','refunds','balance-received','balance'] as AccountingReport[]).map(report=>{
    const selected=accountingReportRows(rows,report);
    return [report,{count:selected.length,total:selected.reduce((sum,row)=>sum+Math.round(row.reportAmount*100),0)/100}];
  })) as Record<AccountingReport,{count:number;total:number}>;
}
export function accountingPaymentSummary(rows:FinanceRecord[]){
  const cents=(value:unknown)=>Math.round((Number(value)||0)*100);
  let cash=0,card=0,upi=0,other=0,received=0,refunded=0,cashRefunded=0;
  for(const row of rows){
    if(row.kind==='payments'){const value=cents(row.receipt);received+=value;if(row.method==='Cash')cash+=value;else if(['Card','Credit Card','Debit Card'].includes(row.method))card+=value;else if(row.method==='UPI')upi+=value;else other+=value;}
    if(row.kind==='refunds'){const value=cents(row.refund);refunded+=value;if(row.method==='Cash')cashRefunded+=value;}
  }
  return {cash:cash/100,card:card/100,upi:upi/100,other:other/100,received:received/100,refunded:refunded/100,net:(received-refunded)/100,netCash:(cash-cashRefunded)/100};
}

export function accountingColumnTotals(rows:FinanceRecord[]){
  const sum=(key:string)=>rows.reduce((total,row)=>total+Math.round((Number(row[key])||0)*100),0)/100;
  return {opdAmount:sum('opdAmount'),registrationAmount:sum('registrationAmount'),maintenanceAmount:sum('maintenanceAmount'),reportAmount:sum('reportAmount')};
}
