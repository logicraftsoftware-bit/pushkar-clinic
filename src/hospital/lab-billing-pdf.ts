import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {labBillingPrintHtml} from './lab-billing-print';
import {jsPDF} from "jspdf";
import {patientName} from '../../server/src/patient-name-display';
import autoTable from "jspdf-autotable";
import {reportPlainText} from "./lab-report-pdf";
import {optimiseReportImages} from "./lab-report-images";
import {BILL_PDF_OPTIONS, BILL_PAGE} from "./billing-paper";
import {patientAgeLabel} from "./patient-age";
type Row=Record<string,any>;
const money=(value:unknown)=>`INR ${Number(value||0).toFixed(2)}`;
const date=(value:unknown)=>{const day=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(day)?day.split('-').reverse().join('/'):'Not recorded';};
export type LabBillCopy='customer'|'pharmacy';
export async function createLabBillingPdf(original:Row,payment?:Row,copy:LabBillCopy='customer'){
  original={...original,patient_name:patientName(original.patient_name)};
  const bill:Row=await optimiseReportImages(original),pdf=new jsPDF({...BILL_PDF_OPTIONS,compress:true});
  const footer=String(bill.pathology_footer_content||""),footerImage=footer.includes('data-print-footer="image"')?footer.match(/<img[^>]+src="([^"]+)"/)?.[1]:undefined;
  const left=14,width=BILL_PAGE.width-left*2,right=BILL_PAGE.width-left;
  const image=(source:string,y:number,height:number,align:'left'|'center'='left')=>{const info=pdf.getImageProperties(source),scale=Math.min(width/info.width,height/info.height);pdf.addImage(source,info.fileType,left+(align==='center'?(width-info.width*scale)/2:0),y,info.width*scale,info.height*scale,undefined,"FAST");};
  const header=bill.pathology_header_image||bill.hospital_logo;
  const headerHeight=header?Math.min(22,width*pdf.getImageProperties(header).height/pdf.getImageProperties(header).width):0;
  const top=header?7+headerHeight+8:18;
  const data=bill.data||{},address=bill.patient_address||bill.address||data.patient_address||data.address;
  const addressText=typeof address==='string'?address:address?[address.line,address.line1,address.line2,address.city,address.district,address.state,address.postal_code||address.pincode].filter(Boolean).join(', '):'Not recorded';
  const phone=bill.patient_phone||bill.phone||data.patient_phone||data.phone||'Not recorded';
  const age=patientAgeLabel({...bill,patient_address:address,date_of_birth:bill.date_of_birth||bill.patient_date_of_birth||data.patient_date_of_birth,age:bill.age||data.age});
  const referring=doctorWithQualification(bill.referred_by_name||data.referred_by_name||data.referring_doctor_name||data.doctor_name||data.referred_by||'Self',bill.referred_by_qualification||data.referred_by_qualification);
  pdf.setFontSize(8);
  const headerRows=[
    [`Invoice: ${bill.record_number||'Not recorded'}`,`Date: ${date(payment?.record_date||bill.record_date)}`],
    [`Patient: ${bill.patient_name||'Not recorded'}`,`UHID: ${bill.medical_record_number||'Not recorded'}`],
    [`Phone: ${phone}`,`Age: ${age}`],
    [`Referring doctor: ${referring}`],
    [`Address: ${addressText}`],
  ].map(row=>row.map(text=>pdf.splitTextToSize(text,row.length===1?182:89) as string[]));
  const bodyTop=top+6+headerRows.reduce((height,row)=>height+Math.max(...row.map(lines=>lines.length))*3.4+1,0)+4;
  const headedPages=new Set<number>();
  function drawHeader(){
    const page=pdf.getCurrentPageInfo().pageNumber;
    if(headedPages.has(page))return;
    headedPages.add(page);
    if(header)image(header,7,22);
    pdf.setDrawColor(210,220,233);pdf.setLineWidth(.25);pdf.line(left,top-5,right,top-5);
    pdf.setTextColor(24,43,70);
    pdf.setFontSize(12);pdf.setFont('helvetica','bold');pdf.text(payment?'Laboratory Payment Receipt':'Laboratory Invoice',14,top);
    pdf.setFont('helvetica','normal');pdf.setFontSize(8);
    let y=top+6;
    for(const row of headerRows){row.forEach((lines,index)=>pdf.text(lines,14+index*93,y));y+=Math.max(...row.map(lines=>lines.length))*3.4+1;}
  }
  const tableStyles={font:'helvetica',fontSize:8,cellPadding:payment?2:1.1,textColor:[35,49,67] as [number,number,number],lineColor:[222,229,238] as [number,number,number],lineWidth:0.1,overflow:'linebreak' as const,valign:'middle' as const};
  const margins={left,right:left,top:bodyTop,bottom:27};
  const headStyles={fillColor:[34,63,108] as [number,number,number],textColor:255,fontStyle:'bold' as const};
  if(payment){
    autoTable(pdf,{styles:tableStyles,startY:bodyTop,theme:"grid",columnStyles:{0:{cellWidth:64,fontStyle:"bold"},1:{cellWidth:width-64}},head:[["Payment details","Value"]],didParseCell:cell=>{if(cell.section==="body"&&cell.column.index===1&&["Amount received in this payment","Balance after this payment"].includes(String(cell.row.raw && (cell.row.raw as string[])[0]))){cell.cell.styles.halign="right";cell.cell.styles.fontStyle="bold";}},body:[["Receipt number",payment.record_number],["Payment date",date(payment.record_date||payment.created_at)],["Payment mode",payment.data?.payment_method||payment.data?.payment_mode||"Not recorded"],["Amount received in this payment",money(payment.amount)],...(payment.data?.transaction_reference?[["Transaction reference",payment.data.transaction_reference]]:[]),...(payment.data?.balance_after!=null?[["Balance after this payment",money(payment.data.balance_after)]]:[])],margin:margins,headStyles,willDrawPage:()=>drawHeader()});
  }else{
    autoTable(pdf,{styles:tableStyles,startY:bodyTop,columnStyles:{0:{cellWidth:width-38},1:{cellWidth:38,halign:"right"}},head:[["Test","Amount"]],body:(bill.tests||[]).map((test:Row)=>[test.name,money(test.amount)]),margin:margins,headStyles,willDrawPage:()=>drawHeader()});
    const y=(pdf as any).lastAutoTable.finalY+3;
    const pharmacyRows=copy==='pharmacy'?[
      ['Refer pharmacy',bill.data?.refer_pharmacy_name||'Not Applicable'],
      ['Pharmacy address',bill.data?.refer_pharmacy_address||''],
      ['Additional discount',money(bill.data?.manual_discount_amount??bill.data?.discount_amount)],
      [`Pharmacy discount (${Number(bill.data?.pharmacy_discount_percentage||0)}%)`,money(bill.data?.pharmacy_discount_amount)],
    ]:[];
    autoTable(pdf,{styles:tableStyles,startY:y,body:[...pharmacyRows.map(row=>[...row,"",""]),["Subtotal",money(bill.amount),"Invoice total",money(bill.total)],["Total discount",money(bill.data?.discount_amount),"Total paid",money(bill.paid)],["Tax",money(bill.data?.tax_amount),"Balance due",money(bill.due)]],theme:"plain",columnStyles:{0:{cellWidth:50},1:{cellWidth:36,halign:"right"},2:{cellWidth:57,fontStyle:"bold"},3:{cellWidth:39,halign:"right",fontStyle:"bold"}},margin:margins,willDrawPage:()=>drawHeader()});
    if(bill.payments?.length)autoTable(pdf,{styles:tableStyles,startY:(pdf as any).lastAutoTable.finalY+3,columnStyles:{0:{cellWidth:83},1:{cellWidth:29},2:{cellWidth:29},3:{cellWidth:41,halign:"right"}},head:[["Payment receipt","Date","Mode","Amount received"]],body:bill.payments.map((row:Row)=>[row.record_number,date(row.record_date||row.created_at),row.data?.payment_method||row.data?.payment_mode||"Not recorded",money(row.amount)]),margin:margins,headStyles,willDrawPage:()=>drawHeader()});
  }
  const count=pdf.getNumberOfPages();for(let page=1;page<=count;page++){pdf.setPage(page);pdf.setDrawColor(220,227,237);pdf.line(left,BILL_PAGE.footerTop-2,right,BILL_PAGE.footerTop-2);pdf.setTextColor(90,103,122);if(footerImage)image(footerImage,BILL_PAGE.footerTop,14,"center");else{pdf.setFontSize(6);pdf.text(pdf.splitTextToSize(reportPlainText(footer),182).slice(0,6),14,BILL_PAGE.footerTop+3);}pdf.setFontSize(8);pdf.text(`Page ${page} of ${count}`,195,BILL_PAGE.height-5,{align:"right"});}
  return pdf;
}
export async function downloadLabBillingPdf(bill:Row,copy:LabBillCopy='customer'){
  const pdf=await createLabBillingPdf(bill,undefined,copy);
  pdf.save(`${String(bill.record_number||'lab-invoice').replace(/[^a-z0-9_-]/gi,'_')}-${copy}.pdf`);
}
export async function printLabBillingPdf(billOrLoad:Row|(()=>Promise<Row>),payment?:Row){
  const popup=window.open("","_blank","width=1000,height=850");
  if(!popup)throw new Error("Allow pop-ups to preview and print the invoice.");
  popup.opener=null;popup.document.body.textContent="Preparing invoice for printing…";
  try{
    const bill=typeof billOrLoad==='function'?await billOrLoad():billOrLoad;
    popup.document.open();
    popup.document.write(labBillingPrintHtml(bill,payment));
    popup.document.close();
  }catch(error){popup.close();throw error;}
}
