import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import SavedLabBill from '../../src/hospital/SavedLabBill.js';

test('saved laboratory bills show itemized tests, patient details, financial totals and a full bill print action',()=>{
  const bill={record_number:'LAB-001',patient_name:'Example Patient',medical_record_number:'UHID-123',record_date:'2026-10-27',amount:1000,total:500,paid:200,due:300,
    tests:[{test_id:'one',name:'EEG',amount:600},{test_id:'two',name:'Blood test',amount:400}],
    data:{discount_amount:500,referred_by:'Dr Example',center:'Guwahati',payment_mode:'Cash'}};
  // The root test runner uses classic JSX; Vite uses the automatic JSX runtime.
  const previous=(globalThis as any).React;
  (globalThis as any).React=React;
  let html:string;
  try{html=renderToStaticMarkup(createElement(SavedLabBill,{initialBill:bill,loadBill:async()=>bill,onClose(){},onNewOrder(){}}));}
  finally{if(previous===undefined)delete (globalThis as any).React;else (globalThis as any).React=previous;}
  for(const text of ['LAB-001','Example Patient','UHID-123','2026-10-27','EEG','Blood test','Dr Example','Guwahati','Cash','INR 600.00','INR 400.00','INR 1000.00','INR 500.00','INR 200.00','INR 300.00','Print Full Bill'])assert.ok(html.includes(text),text);
});
