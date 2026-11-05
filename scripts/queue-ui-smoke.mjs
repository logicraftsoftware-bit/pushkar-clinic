// CI-only browser verification using synthetic responses, never live clinic data.
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
if(process.env.GITHUB_ACTIONS!=='true'||!process.env.QUEUE_BROWSER_MODULE)throw new Error('Run this browser verification on the GitHub runner.');
const {chromium}=createRequire(import.meta.url)(process.env.QUEUE_BROWSER_MODULE);
const preview=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','4183'],{stdio:'ignore'});
const origin='http://127.0.0.1:4183';
let browser;
try{
  for(let attempt=0;attempt<60;attempt++){try{if((await fetch(origin)).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
  await mkdir('artifacts/queue-ui',{recursive:true});browser=await chromium.launch({headless:true});
  const appointment={appointment_number:'APT-000125',serial:3,appointment_date:'2026-11-06',appointment_time:'11:10',status:'Booked',queue_status:'Awaiting check-in',patient_name:'Synthetic Patient',patient_phone:'0000000000',doctor_name:'Dr. Test Clinician',doctor_qualification:'MBBS',department_name:'General Medicine',branch_name:'Synthetic Branch',clinic_name:'Pushkar Clinic ERP',consultation_fee:500,charges:[],discount:0,amount:500,paid_amount:500,payment_status:'Paid',payment_mode:'Cash',estimated_at:'2026-11-06T06:15:00Z',patients_before:2,room:'Consultation Room 2'};
  const rows=[1,2,3].map(serial=>({serial,status:serial===1?'In Consultation':'Waiting',estimated_at:`2026-11-06T06:${String((serial-1)*5).padStart(2,'0')}:00Z`,call_id:serial===1?'synthetic-call-1':null,started_at:'2026-11-06T06:00:00Z'}));
  const queue={status:'NOT STARTED',doctor_name:appointment.doctor_name,department:'General Medicine',doctor_qualification:'MBBS',room:appointment.room,waiting_count:2,current:null,next:rows[0],rows,announcements:{enabled:true,language:'en-IN',include_room:true,include_doctor_name:true,include_patient_name:false,repeat:false}};
  let pass={appointment,queue,updated_at:new Date().toISOString()},display={screen:{name:'Synthetic TV',type:'doctor'},clinic_name:'Pushkar Clinic ERP',queues:[queue],updated_at:new Date().toISOString()};
  const errors=[];
  const context=await browser.newContext({viewport:{width:390,height:844}});
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/api/v1/public/**',async route=>{
    const value=route.request().url().includes('/screens/')?display:pass;
    const stream=route.request().url().endsWith('/events');
    await route.fulfill({status:200,contentType:stream?'text/event-stream':'application/json',body:stream?`event: snapshot\ndata: ${JSON.stringify(value)}\n\n`:JSON.stringify(value)});
  });
  const page=await context.newPage();
  async function heading(text){await page.getByRole('heading',{name:text,exact:true}).waitFor({timeout:20000});}
  async function screenshot(name){
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Horizontal page overflow: '+name);
    await page.screenshot({path:'artifacts/queue-ui/'+name+'.png',fullPage:true});
  }
  await page.goto(origin+'/p/'+'A'.repeat(43));await heading('Appointment confirmed');await screenshot('patient-confirmed-mobile');
  pass={...pass,queue:{...queue,status:'LIVE',current:rows[0]}};
  await heading('Live OPD queue');await screenshot('patient-waiting-mobile');
  pass={...pass,appointment:{...appointment,status:'In Consultation'},queue:{...queue,status:'LIVE',current:{...rows[2],status:'In Consultation',call_id:'synthetic-call-3'}}};
  await heading('It’s your turn!');await screenshot('patient-your-turn-mobile');
  pass={...pass,appointment:{...appointment,status:'Completed'}};
  await heading('Consultation completed');await screenshot('patient-completed-mobile');
  await page.setViewportSize({width:1920,height:1080});
  display={...display,queues:[{...queue,status:'LIVE',current:rows[0]}]};
  await page.goto(origin+'/waiting/'+'B'.repeat(43));await heading('NOW SERVING');await screenshot('doctor-tv-1920');
  await page.getByRole('button',{name:'Enable announcements',exact:true}).click();
  await page.getByRole('button',{name:'Sound on',exact:true}).waitFor();
  display={...display,screen:{name:'Reception TV',type:'reception'}};
  await heading('Live OPD status — all doctors');await screenshot('reception-tv-1920');
  assert.equal(await page.getByRole('button',{name:'Enable announcements',exact:true}).count(),0);
  assert.deepEqual(errors,[],'Browser runtime errors');
  console.log('PASS: mobile appointment states, automatic stream updates, TV layouts and audio controls.');
}finally{await browser?.close();preview.kill();}
