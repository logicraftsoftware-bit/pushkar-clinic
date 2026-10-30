import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {reportSignatories,testReportSignatories} from "../src/lab-signatories.js";
import {decodeReportPdf,newReportShareToken,shareTokenHash} from "../src/lab-report-share-data.js";
import {createLabReportPdf,reportRows} from "../../src/hospital/lab-report-pdf.js";
import {jsPDF} from 'jspdf';
import {reportParameters} from '../src/lab-report-parameters.js';
import {primarySampleNames} from '../src/lab-report-specimens.js';
const fonts={regular:readFileSync(new URL("../../public/fonts/NotoSans-Regular.ttf",import.meta.url)).toString("base64"),bold:readFileSync(new URL("../../public/fonts/NotoSans-Bold.ttf",import.meta.url)).toString("base64")};

test('print and PDF show chart sample names and omit report ID, partial status and technician approval text',async()=>{
  const cbc={test_id:'cbc',name:'CBC',specimen_names:['Whole Blood (EDTA)'],parameters:[{name:'Total Count',value:'8810'},{name:'Unused',value:''}]};
  assert.equal(primarySampleNames(cbc),'EDTA whole blood');
  assert.equal(primarySampleNames({parameters:[{specimen:'Serum'},{specimen:'Serum'}]}),'Serum');
  assert.equal(primarySampleNames({parameters:[]}),'');
  for(const report_preprinted of [false,true]){
    const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
    try{
      await createLabReportPdf({id:'report-id-hidden',report_preprinted,data:{doctor_approval:{test_ids:['cbc'],name:'Doctor Name'},result_entry:{tests:{cbc:{name:'Technician Name'}}}}},[cbc],fonts);
      assert.ok(calls.some(text=>text.includes('Primary Sample(s): EDTA whole blood')));
      assert.ok(calls.some(text=>text.includes('Doctor Name')));
      assert.ok(calls.every(text=>!/Report ID|report-id-hidden|Doctor-approved partial|Approved by|Technician Name|Primary Sample\(s\): Not recorded/.test(text)));
    }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
  }
});

test('letterhead printing leaves 50.8mm above and 12mm below every page without hospital artwork',async()=>{
  const calls:Array<{text:any;x:number;y:number}>=[];
  const hook:any=['postProcessText',(args:any)=>calls.push({text:args.text,x:args.x,y:args.y})];
  jsPDF.API.events.push(hook);
  try{
    const record={report_preprinted:true,hospital_name:'BRANDING OMITTED',pathology_header_image:'invalid image must not be read',hospital_logo:'invalid logo',pathology_footer_content:'FOOTER OMITTED',patient_name:'Patient',data:{technician_approval:{test_ids:["test-a"]},doctor_approval:{test_ids:["test-a"],name:'Approved Doctor'}}};
    const pdf=await createLabReportPdf(record,[{test_id:'test-a',name:'Long test',parameters:Array.from({length:100},(_,i)=>({name:`Parameter ${i}`,value:'12'}))}],fonts);
    assert.ok(pdf.getNumberOfPages()>1);
    assert.ok(calls.length>0);
    for(const call of calls){assert.ok(call.y>=50.8&&call.y<=285,JSON.stringify(call));assert.doesNotMatch(JSON.stringify(call.text),/BRANDING OMITTED|FOOTER OMITTED/);}
    assert.equal(calls.filter(call=>JSON.stringify(call.text).includes('UHID:')).length,pdf.getNumberOfPages());
  }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
});

test("report rows preserve values, reference bands, units and methods",()=>{
  const rows=reportRows({parameters:[{name:"Glucose",value:"101",unit:"mg/dL",method:"Hexokinase",reference_text:"Normal: <100 mg/dL\n100–125"},{name:"Low value",value:'0.1',reference_from:0,reference_to:10}]});
  assert.deepEqual(rows[0],["Glucose","101","mg/dL","Normal: <100 mg/dL\n100–125","Hexokinase"]);
  assert.equal(rows[1][1],"0.1");assert.equal(rows[1][3],"0 – 10");
});

test('print and PDF hide empty and zero parameters while keeping headings with printable results',async()=>{
  const cbc={test_id:'cbc',name:'CBC',parameters:[
    {name:'Total Count',value:'8810'},
    {name:'D.L.C.',result_type_id:'0',value:''},
    {name:'Polymorphs',value:'65'},
    {name:'Unentered Segmented Poly',value:''},
    {name:'Zero Result',value:0},
    {name:'String Zero Result',value:'0'},
    {name:'Decimal Zero Result',value:' 0.00 '},
    {name:'Text Result',value:'Nil'},
    {name:'Whitespace Result',value:'  ',remarks:'Remarks alone must not print a row'},
    {name:'Null Result',value:null},
    {name:'Missing Result'},
    {name:'Empty Section',result_type_id:'0',value:''},
    {name:'Unentered Section Parameter',value:''},
    {name:'End Heading',result_type_id:'5',value:''},
  ]};
  const original=JSON.stringify(cbc);
  assert.deepEqual(reportParameters(cbc).map(p=>p.name),['Total Count','D.L.C.','Polymorphs','Text Result']);
  assert.deepEqual(reportRows(cbc).map(row=>row[0]),['Total Count','D.L.C.','Polymorphs','Text Result']);
  assert.equal(reportRows(cbc)[3][1],'Nil');
  for(const preprinted of [false,true]){
    const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
    try{
      const pdf=await createLabReportPdf({report_preprinted:preprinted,data:{doctor_approval:{test_ids:['cbc'],name:'Doctor'}}},[cbc],fonts);
      assert.equal(pdf.getNumberOfPages(),1);
      assert.ok(calls.some(text=>text.includes('D.L.C.')));
      assert.ok(calls.every(text=>!/(Zero Result|Unentered|Whitespace Result|Null Result|Missing Result|Empty Section|End Heading)/.test(text)));
    }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
  }
  assert.equal(JSON.stringify(cbc),original,'output filtering must not delete or overwrite saved results');
});

test('zero-only reports do not generate empty PDFs and nonzero decimals and ranges remain printable',async()=>{
  const zero={test_id:'zero',parameters:[{name:'Empty heading',result_type_id:'0',value:''},{name:'Zero',value:'0'}]};
  assert.deepEqual(reportRows(zero),[]);
  await assert.rejects(createLabReportPdf({data:{doctor_approval:{test_ids:['zero']}}},[zero],fonts),/Saved results and doctor approval/);
  assert.deepEqual(reportRows({parameters:[{name:'Range',value:'0-2 /hpf'},{name:'Decimal',value:'0.01'}]}).map(row=>row[1]),['0-2 /hpf','0.01']);
});
test("only the approving pathologist's uploaded signature is included",()=>{
  const staff=[{user_id:"doctor-a",first_name:"Dr. A",last_name:"One",professional:{digital_signature:"signature-a"}},{user_id:"doctor-b",first_name:"Dr. B",last_name:"Dutta",professional:{digital_signature:"signature-b"}}];
  assert.deepEqual(reportSignatories({by:"doctor-a"},staff,[]).map(row=>row.signature),["signature-a",""]);
  assert.ok(reportSignatories(null,staff,[]).every(row=>!row.signature));
  const legacy=reportSignatories({legacy:true,staff_ids:["12"]},staff,[{name:"DR. B. DUTTAMD",data:{legacy:{id:"12"}}}]);
  assert.equal(legacy[0].signature,"signature-b");
  assert.ok(reportSignatories({legacy:true,staff_ids:[]},[{first_name:"No",last_name:"Link",professional:{digital_signature:"not-approved"}}],[]).every(row=>!row.signature));
});
test("shared PDF tokens are random and stored as hashes; invalid files are rejected",()=>{
  const token=newReportShareToken();assert.match(token,/^[a-f0-9]{64}$/);assert.notEqual(token,newReportShareToken());assert.notEqual(token,shareTokenHash(token));
  assert.equal(decodeReportPdf(Buffer.from("%PDF-1.7\nexample").toString("base64")).subarray(0,5).toString(),"%PDF-");
  for(const file of ["","not a pdf",Buffer.from("<html>fake</html>").toString("base64"),"A".repeat(16000001)])assert.throws(()=>decodeReportPdf(file));
});
test("a designated report pathologist uses the uploaded signature even when an administrator recorded approval",()=>{
  const profiles=[{id:"profile-a",user_id:"doctor-a",first_name:"Doctor A",professional:{digital_signature:"signature-a"}},{id:"profile-b",first_name:"Doctor B",professional:{digital_signature:"signature-b"}}];
  const rows=reportSignatories({by:"admin",name:"DB",pathologist_id:"profile-b"},profiles,[]);
  assert.equal(rows[0].name,"Doctor B");assert.equal(rows[0].signature,"signature-b");assert.equal(rows[0].approved,true);
  assert.ok(rows.slice(1).every(row=>!row.signature));
  assert.ok(reportSignatories({by:"doctor-a",pathologist_id:"missing"},profiles,[]).every(row=>!row.signature));
});
test("report PDF has one A4 page per short test and extra pages for long result tables",async()=>{
  const record={patient_name:"Report Test",medical_record_number:"TEST-001",patient_gender:"Male",age:"73 years",hospital_name:"Test Hospital",data:{technician_approval:{test_ids:["test-a"]},doctor_approval:{test_ids:["test-a"],name:"Dr. Approver"},collected_at:"2026-10-07T09:47:00Z",result_completed_at:"2026-10-07T11:58:00Z"}};
  const test={test_id:"test-a",name:"Creatinine",parameters:[{name:"Creatinine",value:"1.02",unit:"mg/dL",reference_text:"0.7–1.3",method:"Enzymatic",specimen:"Serum"}]};
  const pdf=await createLabReportPdf(record,[test,test,test],fonts);assert.equal(pdf.getNumberOfPages(),3);assert.ok(Math.abs(pdf.internal.pageSize.getWidth()-210)<0.01);assert.equal(decodeReportPdf(Buffer.from(pdf.output("arraybuffer")).toString("base64")).subarray(0,5).toString(),"%PDF-");
  const long=await createLabReportPdf(record,[{...test,parameters:Array.from({length:90},(_,index)=>({...test.parameters[0],name:`Parameter ${index+1}`}))}],fonts);assert.ok(long.getNumberOfPages()>1);
});

test("report PDF excludes blank tests and rejects reports without saved doctor-approved results",async()=>{
  const complete={test_id:"a",name:"Complete",parameters:[{name:"Result",value:"1"}]};
  const incomplete={test_id:"b",name:"Pending",parameters:[{name:"Result",value:""}]};
  const pdf=await createLabReportPdf({data:{doctor_approval:{test_ids:["a"]},technician_approval:{test_ids:["a"]}}},[complete,incomplete],fonts);
  assert.equal(pdf.getNumberOfPages(),1);
  await assert.rejects(createLabReportPdf({data:{}},[incomplete],fonts),/Saved results and doctor approval/);
});

test('doctor-approved partial CBC generates a PDF without filling blank results or including unapproved tests',async()=>{
  const cbc={test_id:'cbc',name:'Complete Blood Count (CBC)',parameters:[{name:'Total Count',value:'7770',result_type_id:'1'},{name:'Segmented Poly',value:'',result_type_id:'3'}]};
  const unapproved={test_id:'urine',name:'URINE R/E',parameters:[{name:'Result',value:'Normal'}]};
  const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
  try{
    const pdf=await createLabReportPdf({data:{doctor_approval:{test_ids:['cbc'],name:'Doctor'},result_entry:{tests:{cbc:{name:'Technician'}}}}},[cbc,unapproved],fonts);
    assert.equal(pdf.getNumberOfPages(),1);assert.equal(cbc.parameters[1].value,'');
    assert.ok(!calls.some(text=>text.includes('Doctor-approved partial results')));
    assert.ok(!calls.some(text=>text.includes('URINE R/E')));
  }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
});

test('PDF release uses doctor approval without manual technician verification and prints only the correct doctor signature',async()=>{
  const test={test_id:'a',name:'Test A',parameters:[{name:'Value',value:'12'}]};
  const data:any={doctor_approval:{test_ids:['a'],tests:{a:{pathologist_names:['Doctor A']}}},technician_approval:{test_ids:['b']}};
  delete data.technician_approval;
  data.result_entry={tests:{a:{by:'technician-user',name:'Result Technician'}}};
  const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
  try{
    await createLabReportPdf({data,report_signatories:[{name:'Doctor A',approved:true},{name:'Doctor B',approved:true}]},[test],fonts);
    assert.ok(calls.some(text=>text.includes('Doctor A')));
    assert.ok(!calls.some(text=>text.includes('Doctor B')));
    assert.ok(!calls.some(text=>text.includes('Approved by:')));
  }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
});

test('test signatures match staff IDs even with duplicate or renamed doctors, in print and PDF',async()=>{
  const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const signatories=[{id:'doctor-a',name:'Same Name',qualification:'MD A',signature:image,approved:true},{id:'doctor-b',name:'Same Name',qualification:'MD B',signature:image,approved:true}];
  const approval={test_ids:['a','b'],tests:{a:{pathologist_ids:['doctor-a'],pathologist_names:['Old Name']},b:{pathologist_ids:['doctor-b'],pathologist_names:['Same Name']}}};
  assert.deepEqual(testReportSignatories(approval,'a',signatories).map(row=>row.id),['doctor-a']);
  assert.deepEqual(testReportSignatories({tests:{a:{pathologist_ids:['missing']}}},'a',signatories),[]);
  const tests=['a','b'].map(id=>({test_id:id,name:`Test ${id}`,parameters:[{name:'Result',value:'12'}]}));
  for(const preprinted of [false,true]){
    const calls:Array<{text:string;y:number;page:number}>=[];
    const hook:any=['postProcessText',function(this:any,args:any){calls.push({text:JSON.stringify(args.text),y:args.y,page:this.internal.getCurrentPageInfo().pageNumber});}];
    jsPDF.API.events.push(hook);
    try{
      const pdf=await createLabReportPdf({report_preprinted:preprinted,report_signatories:signatories,data:{doctor_approval:approval,technician_approval:{test_ids:['a','b']}}},tests,fonts);
      assert.equal(pdf.getNumberOfPages(),2);
      for(const [page,qualification] of [[1,'MD A'],[2,'MD B']] as const){
        const signature=calls.find(call=>call.page===page&&call.text.includes(qualification))!;
        assert.ok(signature);assert.ok(signature.y<180,'short reports should put signatures below results without a large blank gap');
        assert.ok(!calls.some(call=>call.page===page&&call.text.includes(qualification==='MD A'?'MD B':'MD A')));
        assert.equal(((pdf.internal as any).pages[page].join('\n').match(/\/I\d+ Do/g)||[]).length,1,'each test page must contain its signature image');
      }
      const long=await createLabReportPdf({report_preprinted:preprinted,report_signatories:signatories,data:{doctor_approval:approval,technician_approval:{test_ids:['a']}}},[{...tests[0],parameters:Array.from({length:90},(_,i)=>({name:`Parameter ${i}`,value:'12'}))}],fonts);
      assert.ok(long.getNumberOfPages()>1);
      for(let page=1;page<=long.getNumberOfPages();page++)assert.equal(((long.internal as any).pages[page].join('\n').match(/\/I\d+ Do/g)||[]).length,page===long.getNumberOfPages()?1:0,'the verifying signature belongs after the final results page');
    }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
  }
});

test('missing report units, references and methods print blank while clinical hyphens remain',()=>{
  assert.deepEqual(reportRows({parameters:[{name:'Pus cells',value:'0-1/hpf'}]}),[['Pus cells','0-1/hpf','','','']]);
  assert.deepEqual(reportRows({parameters:[{name:'Value',value:'12',unit:'mg/dL',reference_text:'10-20',method:'Test-method'}]}),[['Value','12','mg/dL','10-20','Test-method']]);
});
test('standard CBC with multiline reference ranges fits one A4 page including signature',async()=>{
  const names=['Total Count','Polymorphs','Lymphocyte','Monocyte','Eosinophil','Basophil','E.S.R.','Haemoglobin','Total R.B.C. Count','Platelet count','M.C.V.','M.C.H.','M.C.H.C.','P.C.V.','RDW-CV','RDW-SD','MPV','PDW','PCT'];
  const parameters=names.map(name=>({name,value:'12',unit:'%',reference_text:name==='Haemoglobin'?'0 - 15 days: 13.4 - 19.8\n16 days - 1 Month: 10.7 - 17.1\n2 - 6 Months: 9.4 - 14.1\n7 Months - 1 year: 11.4 - 14.1\n1 - 9 years: 11.0 - 14.5\n9 - 12 years: 12.0 - 15.0\nM: 13 - 16 F: 11 - 13':name==='Total R.B.C. Count'?'MALE: Male: 4.5-6.5\nFemale: 3.8-5.8\nFEMALE: Male: 4.5-6.5\nFemale: 3.8-5.8':'20 - 40',method:'Calculated'}));
  for(const report_preprinted of [true,false]){
    const calls:string[]=[];const hook:any=['postProcessText',(args:any)=>calls.push(JSON.stringify(args.text))];jsPDF.API.events.push(hook);
    try{
      const pdf=await createLabReportPdf({report_preprinted,data:{doctor_approval:{test_ids:['cbc'],name:'CBC Doctor'}}},[{test_id:'cbc',name:'Complete Blood Count (CBC)',parameters}],fonts);
      assert.equal(pdf.getNumberOfPages(),1);assert.ok(calls.some(text=>text.includes('CBC Doctor')));assert.ok(calls.some(text=>text.includes('PCT')));
    }finally{jsPDF.API.events.splice(jsPDF.API.events.indexOf(hook),1);}
  }
});
