import {readFile} from 'node:fs/promises';
import {jsPDF} from 'jspdf';
import {reportableLabTests} from './lab-result-completion.mjs';
import {reportParameters} from './lab-report-parameters.mjs';
import {testReportSignatories} from './lab-signatories.mjs';
let fonts;
const text=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ');
export async function canonicalReportPdf(record){
  const tests=reportableLabTests(record.tests,record.data);
  if(!tests.length)throw Object.assign(new Error('No doctor-approved printable results are available.'),{status:409});
  if(tests.reduce((sum,test)=>sum+test.parameters.length,0)>5000)throw Object.assign(new Error('Select a smaller report.'),{status:400});
  fonts??=Promise.all(['Regular','Bold'].map(async style=>(await readFile(new URL(`../../public/fonts/NotoSans-${style}.ttf`,import.meta.url))).toString('base64')));
  const [regular,bold]=await fonts,doc=new jsPDF({format:'a4',unit:'mm',compress:true});
  doc.addFileToVFS('NotoSans-Regular.ttf',regular);doc.addFont('NotoSans-Regular.ttf','NotoSans','normal');
  doc.addFileToVFS('NotoSans-Bold.ttf',bold);doc.addFont('NotoSans-Bold.ttf','NotoSans','bold');doc.setFont('NotoSans');
  doc.setProperties({title:'Laboratory Report',author:text(record.hospital_name),creator:'Pushkar Clinic ERP'});
  let y=15;
  function room(height){if(y+height>278){if(doc.internal.getNumberOfPages()>=100)throw Object.assign(new Error('Report exceeds the page limit.'),{status:400});doc.addPage();y=15;}}
  function line(value,size=10,weight='normal',indent=12,width=186){
    doc.setFont('NotoSans',weight);doc.setFontSize(size);
    for(const part of doc.splitTextToSize(text(value),width)){room(size*0.45+2);doc.text(part,indent,y);y+=size*0.45+2;}
  }
  line(record.hospital_name||'Laboratory',16,'bold');line('Laboratory Report',13,'bold');
  line(`Patient: ${text(record.patient_name).toUpperCase()}`);line(`UHID: ${text(record.medical_record_number)}    Bill: ${text(record.bill_number)}`);
  line(`Sample collected: ${text(record.data.collected_at)}`,9);y+=3;
  for(const test of tests){
    room(25);line(test.name,12,'bold');
    if(test.specimen_names?.length)line(`Specimen: ${test.specimen_names.join(', ')}`,9);
    for(const parameter of reportParameters(test)){
      if(String(parameter.result_type_id)==='0'){line(parameter.name,10,'bold');continue;}
      const reference=parameter.reference_text||[parameter.reference_from,parameter.reference_to].filter(value=>value!==undefined&&value!=='').join(' – ');
      line(`${text(parameter.name)}: ${text(parameter.value)}${parameter.unit?' '+text(parameter.unit):''}`,10);
      if(reference)line(`Reference: ${reference}`,8,'normal',16,180);
      if(parameter.remarks)line(`Remarks: ${parameter.remarks}`,8,'normal',16,180);
      if(parameter.method)line(`Method: ${parameter.method}`,8,'normal',16,180);
    }
    for(const signatory of testReportSignatories(record.data.doctor_approval,test.test_id,record.report_signatories??[])){
      room(34);
      if(!/^data:image\/(?:png|jpeg|webp);base64,/.test(signatory.signature??''))throw Object.assign(new Error('Upload a report signature image before sharing this report.'),{status:409});
      const format=signatory.signature.startsWith('data:image/jpeg')?'JPEG':signatory.signature.startsWith('data:image/webp')?'WEBP':'PNG';
      try{doc.addImage(signatory.signature,format,12,y,35,12,`signature-${signatory.id}`);}catch{throw Object.assign(new Error('The report signature image could not be decoded. Upload a valid signature image.'),{status:409});}
      y+=15;line(signatory.name,9,'bold');if(signatory.qualification)line(signatory.qualification,8);line(`Registration: ${signatory.registration_number}`,8);
    }
    y+=6;
  }
  const pages=doc.internal.getNumberOfPages();
  for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFont('NotoSans');doc.setFontSize(8);doc.text(`Confidential laboratory report | Page ${page} of ${pages}`,12,290);}
  const bytes=Buffer.from(doc.output('arraybuffer'));
  if(bytes.length>12000000)throw Object.assign(new Error('Report exceeds the 12 MB limit.'),{status:400});
  return bytes;
}
