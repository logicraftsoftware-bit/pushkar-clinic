import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {jsPDF} from "jspdf";
import {patientName} from '../../server/src/patient-name-display';
import autoTable from "jspdf-autotable";
import {BILL_PDF_OPTIONS,BILL_PAGE} from "./billing-paper";
import {reportPlainText} from "./lab-report-pdf";
type R=Record<string,any>;
const formatBillDate=(value:unknown)=>value?new Date(String(value)).toLocaleString():"--";
type BillLine = { name: string; amount: number; group?: boolean };
export function billLines(data: R): BillLine[] {
  const admission: BillLine[] = [
      {
        name: "Doctor Consultation Fee",
        amount: Number(data.consultation_fee || 0),
      },
      {
        name: "Bed Stay Charges",
        amount: Number(data.bed_daily_charge || 0),
      },
      ...(Array.isArray(data.admission_charges)
        ? data.admission_charges.map((charge: R) => ({
            name: String(charge.label || "Admission Charge"),
            amount: Number(charge.amount || 0),
          }))
        : []),
      {
        name: "Admission Discount",
        amount: -Number(data.admission_discount || 0),
      },
    ].filter((line) => line.amount !== 0);
  return [
    ...admission,
    {
      name: "Admission Charges (Subtotal)",
      amount: admission.reduce((sum, item) => sum + item.amount, 0),
      group: true,
    },
  ];
}
function applyPdfTemplate(pdf:jsPDF,template:R){
  const footer=reportPlainText(String(template.footer_content||""));
  const footerImage=String(template.footer_content||"").includes('data-print-footer="image"') ? String(template.footer_content).match(/<img[^>]+src="([^"]+)"/)?.[1] : undefined;
  function image(source:string,y:number,maxHeight:number){
    const dimensions=pdf.getImageProperties(source),scale=Math.min(182/dimensions.width,maxHeight/dimensions.height);
    const width=dimensions.width*scale,height=dimensions.height*scale;
    pdf.addImage(source,dimensions.fileType,(BILL_PAGE.width-width)/2,y,width,height,undefined,"FAST");
  }
  for(let page=1;page<=pdf.getNumberOfPages();page++){
    pdf.setPage(page);
    if(template.header_image){try{image(template.header_image,5,18);}catch{/* Keep the bill printable if configured artwork is invalid. */}}
    if(footerImage) image(footerImage,BILL_PAGE.footerTop,14);
    else if(footer){
      pdf.setDrawColor(210,218,228);pdf.line(14,BILL_PAGE.footerTop,196,BILL_PAGE.footerTop);
      pdf.setFont("helvetica","normal");pdf.setFontSize(7.5);pdf.setTextColor(80,90,105);
      pdf.text(pdf.splitTextToSize(footer,178).slice(0,2),105,BILL_PAGE.footerTop+4,{align:"center"});
    }
  }
}
export function createInvoicePdf(row:R,template:R={}) {
  row={...row,patient_name:patientName(row.patient_name)};
  const data = row.data ?? {},
    lines = billLines(data),
    pdf = new jsPDF(BILL_PDF_OPTIONS);
  const amount = (value: unknown) => `Rs. ${Number(value || 0).toFixed(2)}`;
  pdf.setTextColor(23, 35, 59);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(15);
  const top=template.header_image?29:12;
  pdf.text(String(row.hospital_name || "Hospital"), 105, top, {
    align: "center",
  });
  pdf.setFontSize(11);
  pdf.text("Interim Patient Bill", 105, top+7, { align: "center" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8.5);
  pdf.text(`Bill No: ${row.record_number}`, 14, top+16);
  pdf.text(`Bill Date: ${row.record_date || "—"}`, 196, top+16, { align: "right" });
  autoTable(pdf, {
    startY: top+20,
    margin: {left:14,right:14,top:template.header_image?28:10,bottom:27},
    theme: "grid",
    styles: {
      fontSize: 7,
      cellPadding: 1.3,
      lineColor: [150, 160, 175],
      lineWidth: 0.15,
    },
    body: [
      [
        "Patient ID",
        row.medical_record_number || "—",
        "Admission Date",
        formatBillDate(data.admitted_at),
      ],
      [
        "Patient Name",
        row.patient_name || "—",
        "Admitting Doctor",
        doctorWithQualification(data.doctor_name,row.doctor_qualification||data.doctor_qualification) || "—",
      ],
      [
        "Ward / Room / Bed",
        `${data.ward_name || "—"} / ${data.room_number || "—"} / ${data.bed_number || "—"}`,
        "Specialty",
        data.department_name || "—",
      ],
      ["IPD No", data.ipd_number || "—", "Payer", data.payer || "Self"],
    ],
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 28 },
      1: { cellWidth: 63 },
      2: { fontStyle: "bold", cellWidth: 28 },
      3: { cellWidth: 63 },
    },
  });
  autoTable(pdf, {
    startY: (pdf as R).lastAutoTable.finalY + 3,
    margin: {left:14,right:14,top:template.header_image?28:10,bottom:27},
    theme: "grid",
    head: [["Service Name", "Date / Time", "Rate", "Qty", "Total (Rs.)"]],
    body: lines.map((line) =>
      line.group
        ? [
            {
              content: line.name,
              colSpan: 4,
              styles: {
                halign: "right",
                fontStyle: "bold",
                fillColor: [242, 245, 249],
              },
            },
            {
              content: amount(line.amount),
              styles: {
                halign: "right",
                fontStyle: "bold",
                fillColor: [242, 245, 249],
              },
            },
          ]
        : [
            line.name,
            formatBillDate(data.admitted_at),
            amount(line.amount),
            "1.00",
            amount(line.amount),
          ],
    ),
    styles: {
      fontSize: 7,
      cellPadding: 1.3,
      lineColor: [150, 160, 175],
      lineWidth: 0.15,
    },
    headStyles: {
      fillColor: [225, 231, 239],
      textColor: [23, 35, 59],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 58 },
      1: { cellWidth: 42 },
      2: { cellWidth: 30, halign: "right" },
      3: { cellWidth: 20, halign: "right" },
      4: { cellWidth: 32, halign: "right" },
    },
  });
  const summaryStart=(pdf as R).lastAutoTable.finalY+7;
  if(summaryStart+34>BILL_PAGE.footerTop-4)pdf.addPage();
  const y = summaryStart+34>BILL_PAGE.footerTop-4?(template.header_image?30:15):summaryStart,
    summary = [
      ["Total", amount(row.total)],
      [
        "Discounts",
        amount(
          Number(data.registration_discount || 0) +
            Number(data.admission_discount || 0),
        ),
      ],
      [
        "Patient Deposit Received",
        amount(
          Number(data.registration_deposit || 0) +
            Number(data.admission_deposit || 0),
        ),
      ],
      ["Net Payable", amount(row.due)],
    ];
  summary.forEach(([label, value], index) => {
    pdf.setFont("helvetica", index === summary.length - 1 ? "bold" : "normal");
    pdf.text(label, 105, y + index * 6);
    pdf.text(value, 196, y + index * 6, { align: "right" });
  });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(
    pdf.splitTextToSize("If you have any queries regarding the contents of this bill, kindly contact the Billing Department.",182),
    105,
    y + 27,
    { align: "center" },
  );
  applyPdfTemplate(pdf,template);return pdf;
}
export function createPaymentReceiptPdf(payment:R,invoice:R,template:R={}){
  invoice={...invoice,patient_name:patientName(invoice.patient_name)};
  const pdf=new jsPDF(BILL_PDF_OPTIONS),method=payment.data?.payment_method||"--",note=payment.data?.note||payment.data?.notes||payment.data?.transaction_reference||"--",top=template.header_image?29:12;
  pdf.setFont("helvetica","bold");pdf.setFontSize(13);pdf.text(String(invoice.hospital_name||"Hospital"),105,top,{align:"center"});pdf.setFontSize(11);pdf.text("Payment Receipt",105,top+7,{align:"center"});
  autoTable(pdf,{startY:top+13,margin:{left:14,right:14,top:template.header_image?28:10,bottom:27},styles:{fontSize:8,cellPadding:1.5},theme:"grid",body:[["Transaction ID",payment.record_number],["Invoice",invoice.record_number],["Patient",invoice.patient_name],["UHID",invoice.medical_record_number],["Date",formatBillDate(payment.created_at||payment.record_date)],["Payment Mode",method],["Note",note],["Paid Amount",`Rs. ${Number(payment.amount||0).toFixed(2)}`]],columnStyles:{0:{fontStyle:"bold",cellWidth:48},1:{cellWidth:134}}});
  const noteY=(pdf as R).lastAutoTable.finalY+8;if(noteY>BILL_PAGE.footerTop-4)pdf.addPage();pdf.setFont("helvetica","normal");pdf.setFontSize(8);pdf.text("This is a computer-generated payment receipt.",105,noteY>BILL_PAGE.footerTop-4?template.header_image?28:12:noteY,{align:"center"});applyPdfTemplate(pdf,template);return pdf;
}
