import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {PRESCRIPTION_PRINT_CSS,prescriptionObservationsHtml} from "./prescription-paper";
import {BILL_PRINT_CSS,OPD_BILL_PRINT_CSS} from "./billing-paper";
import {patientAgeLabel} from "./patient-age";
import {patientName} from '../../server/src/patient-name-display';
import { useState } from "react";
import { FileText, Printer, Receipt, Stethoscope } from "lucide-react";

type Row = Record<string, any>;
type DocumentKind = "consultation" | "bill" | "prescription";
const API = import.meta.env?.VITE_API_URL ?? (import.meta.env?.PROD ? "" : "http://localhost:4000");
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]!);
const money = (value: unknown) => `INR ${Number(value || 0).toFixed(2)}`;
const date = (value: unknown) => String(value || "").slice(0,10).split("-").reverse().join("/");

export function opdDocumentHtml(row: Row, template: Row, kind: DocumentKind) {
  row={...row,doctor_name:doctorWithQualification(row.doctor_name,row.doctor_qualification),patient_name:patientName(row.patient_name)};
  const title = {consultation:"Consultation Receipt",bill:"OPD Bill",prescription:"OPD Prescription"}[kind];
  const meta = [["Patient",row.patient_name],["UHID",row.medical_record_number],["Age",patientAgeLabel(row)],["Doctor",row.doctor_name],["Department",row.department_name],["Appointment",row.appointment_number],["Date / Time",`${date(row.appointment_date)} · ${String(row.appointment_time || "").slice(0,5)}`],["Branch",row.branch_name],["Visit",row.visit_type]];
  if(kind === "prescription") meta.splice(2,0,["Phone",row.patient_phone || row.phone]);
  const heading = `<header class="title"><h1>${title}</h1><span>${escape(row.appointment_number)}</span></header>`;
  const charges: Row[] = Array.isArray(row.charges) ? row.charges : [];
  const subtotal = Number(row.consultation_fee || 0) + charges.reduce((sum,charge) => sum + Number(charge.amount || 0),0);
  const total = Math.max(0,subtotal-Number(row.discount || 0)), paid = Number(row.paid_amount || 0);
  const billingRows = [{label:"Doctor consultation",amount:row.consultation_fee},...charges];
  const content = kind === "consultation" ? `<section class="token"><span>YOUR CONSULTATION TOKEN</span><strong>${escape(row.queue_serial || row.slot_serial || row.token_number || "Pending")}</strong><p>${escape(row.doctor_name)} · ${escape(row.department_name)}</p></section><div class="receipt"><div><span>Appointment type</span><b>${escape(row.appointment_type || "OPD")}</b></div><div><span>Visit type</span><b>${escape(row.visit_type)}</b></div><div><span>Consultation fee</span><b>${money(row.consultation_fee)}</b></div><div><span>Payment status</span><b>${escape(row.payment_status)}</b></div></div><p class="hint">Please keep this receipt available when your token is called.</p>` : kind === "bill" ? `<table><thead><tr><th>#</th><th>Service</th><th class="amount">Amount</th></tr></thead><tbody>${billingRows.map((charge,index)=>`<tr><td>${index+1}</td><td>${escape(charge.label || charge.name || "Charge")}</td><td class="amount">${money(charge.amount)}</td></tr>`).join("")}</tbody></table><section class="totals">${[["Subtotal",subtotal],["Discount",row.discount],["Total",total],["Paid",paid],["Balance",Math.max(0,total-paid)]].map(([label,value])=>`<div${label==="Total"?' class="grand"':""}><span>${label}</span><b>${money(value)}</b></div>`).join("")}</section><section class="receipt"><div><span>Payment mode</span><b>${escape(row.payment_mode || "Not recorded")}</b></div><div><span>Payment status</span><b>${escape(row.payment_status)}</b></div></section>` : `<section class="rx"><div class="rx-notes"><div class="clinical-writing-space"><h3>Clinical details:</h3></div><h3>Investigation:</h3></div><div class="rx-main"><h3>℞ &nbsp; Prescription</h3></div></section><section class="signature"><span>Next follow-up: __________________</span><span>Doctor signature: __________________</span></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} - ${escape(row.appointment_number)}</title><style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{font:11px/1.5 Arial,sans-serif;color:#19334b;margin:0;min-height:277mm;display:flex;flex-direction:column}.header img{display:block;width:100%;height:auto;max-height:45mm;object-fit:contain}.title{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #4963ad;padding:12px 0 8px;margin-bottom:12px}.title h1{font-size:20px;margin:0}.title span{font-size:10px;color:#61778b}.meta{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;padding:12px;background:#f5f8fc;border:1px solid #dbe4ed;border-radius:8px;margin-bottom:18px}.meta div{display:grid;grid-template-columns:95px 1fr}.meta b{color:#6c7f90;font-weight:normal}.meta span{font-weight:bold;overflow-wrap:anywhere}.token{text-align:center;padding:22px;border:2px solid #4963ad;border-radius:12px;margin:10px 0 22px}.token>span{letter-spacing:2px;font-size:9px;color:#60788b}.token strong{display:block;font-size:28px;overflow-wrap:anywhere;margin:10px 0}.token p{margin:0}.receipt{display:flex;justify-content:space-between;gap:15px;border-top:1px solid #dbe4ed;padding:12px 0}.receipt span,.receipt b{display:block}.receipt span{font-size:9px;color:#657c90}.hint{color:#657c90;font-size:10px}table{width:100%;border-collapse:collapse}th{background:#f1f5fa;text-align:left;color:#61788e;font-size:9px;text-transform:uppercase}th,td{padding:10px;border-bottom:1px solid #dbe4ed}.amount{text-align:right}.totals{width:280px;margin:16px 0 20px auto}.totals div{display:flex;justify-content:space-between;padding:5px}.grand{font-size:14px;border-top:2px solid #4963ad}.rx{display:grid;grid-template-columns:32% 68%;min-height:155mm;border:1px solid #dbe4ed;border-radius:8px;margin:10px 0}.rx>div{padding:14px}.rx-main{border-left:1px solid #dbe4ed}.rx h3{margin:0;font-size:12px}.signature{display:flex;justify-content:space-between;margin:12px 0 24px}.footer{margin-top:auto;border-top:1px solid #ccd9e4;padding-top:8px;break-inside:avoid;font-size:10px;white-space:pre-wrap}.footer img{max-width:100%;height:auto}.footer table{width:100%}.single-page-prescription{height:276mm;min-height:0;break-inside:avoid;page-break-inside:avoid}.single-page-prescription>.header,.single-page-prescription>.title,.single-page-prescription>.meta,.single-page-prescription>.signature,.single-page-prescription>.footer{flex-shrink:0}.single-page-prescription .rx{flex:1;min-height:20mm;margin:6px 0}.single-page-prescription .signature{margin:8px 0 12px}.single-page-prescription .footer{margin-top:0;white-space:normal}.single-page-prescription .footer p{margin:4px 0}@media print{body{print-color-adjust:exact}}${kind === "prescription" ? PRESCRIPTION_PRINT_CSS : kind === "bill" ? OPD_BILL_PRINT_CSS : BILL_PRINT_CSS}</style></head><body class="${kind === "prescription" ? "single-page-prescription" : ""}">${kind !== "prescription" && template.header_image?`<div class="header"><img src="${escape(template.header_image)}" alt="Clinic header"></div>`:""}${kind === "prescription" ? "" : heading}<section class="meta">${meta.map(([label,value])=>`<div><b>${label}</b><span>${escape(value || "—")}</span></div>`).join("")}</section>${kind === "prescription" ? prescriptionObservationsHtml()+heading : ""}${content}${kind !== "prescription" && template.footer_content?`<footer class="footer">${template.footer_content}</footer>`:""}</body></html>`;
}

export default function OpdDocuments({ row, token }: {row: Row; token: string}) {
  const [busy,setBusy]=useState<DocumentKind|null>(null),[error,setError]=useState("");
  async function print(kind: DocumentKind) {
    const popup=window.open("","_blank","width=950,height=850");
    if(!popup){setError("Allow pop-ups to print appointment documents.");return;}
    popup.opener=null;popup.document.body.textContent="Loading document...";
    setBusy(kind);setError("");
    try {
      const document={consultation:"appointment",bill:"opd-bill",prescription:"opd-prescription"}[kind];
      const response=await fetch(`${API}/api/v1/clinical/print-template/${document}`,{headers:{Authorization:`Bearer ${token}`}});
      const template=await response.json();if(!response.ok)throw new Error(template.error || "Unable to load Admin print template");
      popup.document.open();popup.document.write(opdDocumentHtml(row,template,kind));popup.document.close();
      await Promise.all(Array.from(popup.document.images).map(img=>img.complete?Promise.resolve():new Promise(resolve=>{img.onload=resolve;img.onerror=resolve;})));
      await popup.document.fonts.ready;
      popup.focus();popup.print();
    } catch(error) {popup.close();setError(error instanceof Error?error.message:"Unable to print document");}
    finally {setBusy(null);}
  }
  return <section className="co-document-actions"><div><strong>Appointment documents</strong><span>Print or save as PDF using your clinic templates.</span></div><div className="co-document-buttons">
    <button type="button" disabled={!!busy} onClick={()=>print("consultation")}><Stethoscope/><span>Consultation Receipt<small>Doctor &amp; token</small></span></button>
    <button type="button" disabled={!!busy} onClick={()=>print("bill")}><Receipt/><span>Bill<small>Charges &amp; payment</small></span></button>
    <button type="button" disabled={!!busy} onClick={()=>print("prescription")}><FileText/><span>Prescription<small>Blank prescription</small></span></button>
  </div>{busy&&<p><Printer/> Preparing document...</p>}{error&&<p role="alert" className="co-error">{error}</p>}</section>;
}
