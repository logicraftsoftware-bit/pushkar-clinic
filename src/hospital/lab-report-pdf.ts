import {doctorWithQualification} from '../../server/src/doctor-print-display';
import {testReportSignatories} from "../../server/src/lab-signatories";
import {patientName} from '../../server/src/patient-name-display';
import {primarySampleNames} from '../../server/src/lab-report-specimens';
import {isPapSmearTest} from '../../server/src/lab-result-format';
import {reportParameters} from '../../server/src/lab-report-parameters';
import {reportableLabTests} from "../../server/src/lab-result-completion";
import {jsPDF} from './pdf-engine.js';
import autoTable from "jspdf-autotable";
import {patientAgeLabel} from "./patient-age";
import JsBarcode from "jsbarcode";
type Row=Record<string,any>;
type FontFiles={regular:string;bold:string};
let fonts:Promise<FontFiles>|undefined;
const base64=(buffer:ArrayBuffer)=>{const bytes=new Uint8Array(buffer),chunks:string[]=[];for(let index=0;index<bytes.length;index+=8192)chunks.push(String.fromCharCode(...bytes.subarray(index,index+8192)));return btoa(chunks.join(""));};
function loadFonts(){return fonts??=Promise.all(["Regular","Bold"].map(async style=>{const response=await fetch(`/fonts/NotoSans-${style}.ttf`);if(!response.ok)throw new Error("Unable to load report fonts. Refresh and try again.");return base64(await response.arrayBuffer());})).then(([regular,bold])=>({regular,bold})).catch(error=>{fonts=undefined;throw error;});}
const label=(value:unknown,fallback="—")=>String(value??"").trim()||fallback;
export const reportFilename=(record:Row)=>`Lab-Report-${String(record.medical_record_number||record.id||"patient").replace(/[^a-z0-9_-]/gi,"-")}.pdf`;
export function reportPlainText(html:unknown){return String(html||"").replace(/<\/(p|div|li)>|<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&#39;/g,"'").replace(/&quot;/g,'"').trim();}
export function reportRows(test:Row){return reportParameters(test).map((parameter:Row)=>String(parameter.result_type_id)==='0'?[label(parameter.name),'','','','']:[label(parameter.name),label(parameter.value),label(parameter.unit,""),parameter.reference_text||[parameter.reference_from,parameter.reference_to].filter(value=>value!==undefined&&value!==null&&value!=="").join(" – ")||"",label(parameter.method,"")]);}
const date=(value:unknown)=>{const d=new Date(String(value||""));return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat("en-IN",{dateStyle:"short",timeStyle:"short"}).format(d);};

export async function createLabReportPdf(record:Row,tests:Row[],fontFiles?:FontFiles){
  record={...record,patient_name:patientName(record.patient_name)};
  const preprinted=record.report_preprinted===true;
  if(preprinted)record={...record,pathology_header_image:undefined,pathology_footer_content:"",hospital_logo:undefined};
  tests=reportableLabTests(tests,record.data||{});
  if(!tests.length)throw new Error("Saved results and doctor approval are required before generating a report");
  const font=fontFiles||await loadFonts(),pdf=new jsPDF({unit:"mm",format:"a4",compress:true});
  pdf.addFileToVFS("NotoSans-Regular.ttf",font.regular);pdf.addFont("NotoSans-Regular.ttf","Report","normal");pdf.addFileToVFS("NotoSans-Bold.ttf",font.bold);pdf.addFont("NotoSans-Bold.ttf","Report","bold");pdf.setFont("Report","normal");
  const imageProperties=new Map<string,ReturnType<typeof pdf.getImageProperties>>(); const properties=(source:string)=>{if(!imageProperties.has(source))imageProperties.set(source,pdf.getImageProperties(source));return imageProperties.get(source)!;};
  pdf.setFontSize(6.5);
  const footer=String(record.pathology_footer_content||""),footerImage=footer.includes('data-print-footer="image"')?footer.match(/<img[^>]+src="([^"]+)"/)?.[1]:undefined;
  const footerText=reportPlainText(footer),footerLines=pdf.splitTextToSize(footerText,190) as string[];
  const footerHeight=footerImage?Math.min(35,190*properties(footerImage).height/properties(footerImage).width):Math.min(35,footerLines.length*2.8+3);
  const signatories:Row[]=Array.isArray(record.report_signatories)?record.report_signatories.filter((doctor:Row)=>doctor.approved):[];
  const signRows=Math.max(1,...tests.map(test=>Math.ceil(testReportSignatories(record.data?.doctor_approval,test.test_id,signatories).length/3))),footerTop=285-footerHeight,signTop=footerTop-28*signRows;
  const drawImage=(image:string,x:number,y:number,width:number,maxHeight:number,align:"center"|"left"="center")=>{const info=properties(image),scale=Math.min(width/info.width,maxHeight/info.height);pdf.addImage(image,info.fileType,x+(align==="left"?0:(width-info.width*scale)/2),y,info.width*scale,info.height*scale,String([...imageProperties.keys()].indexOf(image)),"FAST");};
  const headerHeight=record.pathology_header_image?Math.min(32,190*properties(record.pathology_header_image).height/properties(record.pathology_header_image).width):24;
  const details=[["UHID",record.medical_record_number,"Bill ID",record.bill_number||record.data?.legacy_opd_id],["Name",record.patient_name,"Collection Date",date(record.data?.collected_at)],["Age / Sex",`${patientAgeLabel(record)} / ${label(record.patient_gender||record.data?.gender)}`,"Completion Date",date(record.data?.result_completed_at)],["Ref. Doctor",doctorWithQualification(record.referred_by_name||record.data?.referred_by||"Self",record.referred_by_qualification||record.data?.referred_by_qualification),"",""]];
  pdf.setFontSize(8);
  const metaRows=details.map(row=>{const left=pdf.splitTextToSize(label(row[1]),72) as string[],right=row[2]?pdf.splitTextToSize(label(row[3]),56) as string[]:[];return {row,left,right,height:Math.max(6,Math.max(left.length,right.length)*3.6+2)};});
  const metaStart=preprinted?53.8:7+headerHeight+7,primaryY=metaStart+metaRows.reduce((sum,row)=>sum+row.height,0)+1,tableTop=primaryY+25;
  const barcode:{encodings?:Array<{data:string}>}={};JsBarcode(barcode,String(record.medical_record_number||record.id||"REPORT").replace(/[^\x20-\x7E]/g,"").slice(0,80)||"REPORT",{format:"CODE128",displayValue:false});
  function header(test:Row){
    if(/^data:image\/(png|jpeg|webp);base64,/.test(record.hospital_logo||"")){pdf.saveGraphicsState();pdf.setGState(pdf.GState({opacity:0.06}));drawImage(record.hospital_logo,20,110,170,100);pdf.restoreGraphicsState();}
    pdf.setFont("Report","normal");pdf.setTextColor(20,20,20);
    if(!preprinted&&record.pathology_header_image)drawImage(record.pathology_header_image,10,7,190,32);
    else if(!preprinted){pdf.setFont("Report","bold");pdf.setFontSize(19);pdf.text(label(record.hospital_name,"Clinic Laboratory"),105,19,{align:"center"});pdf.setFont("Report","normal");pdf.setFontSize(9);pdf.text(label(record.branch_name,"Laboratory Services"),105,27,{align:"center"});}
    pdf.setFontSize(8);let y=metaStart;metaRows.forEach(({row,left,right,height})=>{pdf.setDrawColor(200);pdf.line(10,y+height-4,200,y+height-4);pdf.setFont("Report","normal");pdf.text(`${row[0]}:`,11,y);pdf.text(left,35,y);if(row[2]){pdf.text(`${row[2]}:`,112,y);pdf.text(right,144,y);}y+=height;});
    const specimens=primarySampleNames(test);if(specimens)pdf.text(`Primary Sample(s): ${specimens}`,11,primaryY);
    const bars=(barcode.encodings||[]).map(row=>row.data).join("");pdf.setFillColor(0,0,0);for(let index=0;index<bars.length;index++)if(bars[index]==="1")pdf.rect(45+index*120/bars.length,primaryY+3,120/bars.length,7,"F");
    pdf.setFont("Report","bold");pdf.setFontSize(10);pdf.text("DEPARTMENT OF PATHOLOGY",105,primaryY+15,{align:"center"});pdf.setDrawColor(25);pdf.setLineWidth(0.5);pdf.line(10,primaryY+17,200,primaryY+17);pdf.setLineWidth(0.15);
    pdf.setFontSize(9);pdf.text(label(test.name),11,primaryY+22);
  }
  function signatures(test:Row,signatureTop:number){
    const testSignatories=testReportSignatories(record.data?.doctor_approval,test.test_id,signatories);
    pdf.setFont("Report","normal");pdf.setFontSize(8);pdf.text("--- End of report ---",105,signatureTop-4,{align:"center"});
    if(!record.data?.doctor_approval){pdf.setTextColor(155,50,30);pdf.text("DRAFT — awaiting doctor approval",105,signatureTop+3,{align:"center"});pdf.setTextColor(20);}
    testSignatories.forEach((doctor,index)=>{const columns=Math.min(3,testSignatories.length),x=12+(index%3)*(190/columns),width=190/columns-4,signatureY=signatureTop+Math.floor(index/3)*28;if(doctor.signature&&doctor.approved)drawImage(doctor.signature,x,signatureY+2,Math.min(width,45),12,"left");pdf.setFont("Report","bold");pdf.setFontSize(7.5);pdf.text(pdf.splitTextToSize(doctorWithQualification(doctor.name,doctor.qualification),width),x,signatureY+17);pdf.setFont("Report","normal");pdf.setFontSize(6.5);pdf.text(label(doctor.designation,"Consultant Pathologist"),x,signatureY+22);});
    if(!signatories.length&&record.data?.doctor_approval)pdf.text(doctorWithQualification(label(record.data.doctor_approval.name,"Verified in legacy laboratory"),record.data.doctor_approval.qualification),12,signatureTop+17);
  }
  function bottom(test:Row){
    pdf.setFont("Report","normal");pdf.setFontSize(6.5);
    if(footerImage)drawImage(footerImage,10,footerTop,190,35);else if(footerText)pdf.text(footerLines.slice(0,12),10,footerTop+2);
  }
  for(let index=0;index<tests.length;index++){
    if(index)pdf.addPage();const test=tests[index],parameters=reportParameters(test),narrative=isPapSmearTest(test),rows:any[]=narrative?parameters.flatMap(parameter=>String(parameter.result_type_id)==='0'?[[{content:label(parameter.name),colSpan:5,styles:{fontStyle:'bold'}}]]:[[{content:label(parameter.name),colSpan:5,styles:{fontStyle:'bold'}}],[{content:label(parameter.value),colSpan:5,styles:{fontStyle:'normal',cellPadding:{top:3,right:2,bottom:5,left:2}}}]]):reportRows(test).map((row,i)=>String(parameters[i].result_type_id)==='0'?[{content:row[0],colSpan:5,styles:{fontStyle:'bold'}}]:row);
    const notes=narrative?"":[test.notes,...(test.summaries||[]).map((item:Row)=>item.summary)].filter(Boolean).map(reportPlainText).join("\n\n");
    if(notes)rows.push([{content:notes,colSpan:5,styles:{fontSize:8,fontStyle:"normal",cellPadding:{top:5,right:1,bottom:3,left:1}}}]);
    const compactCbc=/\bcbc\b|\bcomplete\s+(?:blood|haemogram|hemogram)\b/i.test(String(test.name||""));
    autoTable(pdf,{startY:tableTop,margin:{top:tableTop,bottom:297-signTop+9,left:10,right:10},head:narrative?[[{content:'REPORT DESCRIPTION',colSpan:5}]]:[["TEST","RESULTS","UNIT","BIOLOGICAL REF. INTERVAL","METHOD"]],body:rows,theme:"plain",styles:{font:"Report",fontSize:compactCbc?7.5:8.5,textColor:[20,20,20],cellPadding:{top:compactCbc?0.7:2,right:1,bottom:compactCbc?0.7:2,left:1},overflow:"linebreak"},headStyles:{fontStyle:"bold",fontSize:8,lineWidth:{top:0.4,bottom:0.2},lineColor:[30,30,30]},columnStyles:compactCbc?{0:{cellWidth:52,fontStyle:"bold"},1:{cellWidth:21},2:{cellWidth:21},3:{cellWidth:66},4:{cellWidth:30}}:{0:{cellWidth:64,fontStyle:"bold"},1:{cellWidth:21},2:{cellWidth:21},3:{cellWidth:59},4:{cellWidth:25}},rowPageBreak:"avoid",willDrawPage:()=>header(test),didDrawPage:()=>bottom(test)});
    signatures(test,Math.min(((pdf as any).lastAutoTable?.finalY||tableTop)+10,signTop));
  }
  const count=pdf.getNumberOfPages();for(let page=1;page<=count;page++){pdf.setPage(page);pdf.setFont("Report","normal");pdf.setFontSize(6.5);pdf.text(`Page ${page} of ${count}`,199,preprinted?284:291,{align:"right"});}
  pdf.setProperties({title:`Laboratory Report — ${record.patient_name||"Patient"}`,subject:"Pathology results",creator:record.hospital_name||"Clinic ERP"});return pdf;
}
