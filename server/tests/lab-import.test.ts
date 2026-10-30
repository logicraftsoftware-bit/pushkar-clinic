import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, csvNumber, legacyTimestamp, legacyUuid } from "../src/lab-csv.js";
import { calculateLabFormula, qcEvaluation, selectLabReference } from "../src/lab-clinical.js";

test("legacy CSV retains quoted newlines, commas and escaped quotes",()=>{
  assert.deepEqual(parseCsv('\uFEFFid,name,result\r\n1,"Panel, A","line 1\nline ""2"""\r\n'),[{id:"1",name:"Panel, A",result:'line 1\nline "2"'}]);
  assert.throws(()=>parseCsv('id,name\n1,"unclosed'));
  assert.throws(()=>parseCsv('id,name\n1,second,third'));
  assert.throws(()=>parseCsv('id,id\n1,2'));
});
test("source timestamps reject impossible dates and preserve India time",()=>{
  assert.equal(legacyTimestamp("07/10/2026","15:30:00"),"2026-10-07T15:30:00+05:30");
  assert.equal(legacyTimestamp("31/02/2026"),null);
  assert.equal(legacyTimestamp("2026-10-07","25:00:00"),null);
  assert.equal(csvNumber("1,234.56","rate"),1234.56);
  assert.throws(()=>csvNumber("unknown","rate"));
});
test("import identities are deterministic and tenant scoped",()=>{
  assert.equal(legacyUuid("hospital-a","test","42"),legacyUuid("hospital-a","test","42"));
  assert.notEqual(legacyUuid("hospital-a","test","42"),legacyUuid("hospital-b","test","42"));
  assert.notEqual(legacyUuid("hospital-a","test","42"),legacyUuid("hospital-a","parameter","42"));
});
test("legacy formulas support precedence while rejecting executable syntax and missing values",()=>{
  assert.equal(calculateLabFormula("p150@-@p27@-@p40@/@5",{"150":200,"27":50,"40":100}),"130.00");
  assert.equal(calculateLabFormula("(@p1@+@p2@)@/@2",{"1":1,"2":2},3),"1.500");
  assert.throws(()=>calculateLabFormula("process.exit()",{}));
  assert.throws(()=>calculateLabFormula("p1/0",{"1":3}));
  assert.throws(()=>calculateLabFormula("p2+1",{"1":3}));
});
test("QC uses exact thresholds, including negative deviations",()=>{
  assert.deepEqual(qcEvaluation(104,100,2),{z_score:2,status:"Warning"});
  assert.equal(qcEvaluation(94,100,2).status,"Out of Control");
  assert.equal(qcEvaluation(103.99,100,2).status,"In Control");
  assert.throws(()=>qcEvaluation(100,100,0));
});
test("reference rules never guess between overlapping ranges",()=>{
  const male={sex:"MALE",age_from:"0",age_to:"1000",value_from:"1",value_to:"2"};
  assert.equal(selectLabReference([male],"Male",100),male);
  assert.equal(selectLabReference([male],"Female",100),null);
  assert.equal(selectLabReference([male,{...male}],"Male",100),null);
  assert.equal(selectLabReference([male],"Male",null),null);
});
