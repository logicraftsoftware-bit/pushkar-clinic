import {test} from "node:test";
import assert from "node:assert/strict";
import {z} from "zod";
import {patientAgeFields,patientAgeDays} from "../src/patient-age.js";
import {patientAgeLabel,patientAgeParts} from "../../src/hospital/patient-age.ts";

test("age-only patient details display without creating a date of birth",()=>{
  assert.equal(patientAgeLabel({address:{age_years:42,age_months:3,age_days:2}}),"42 years 3 months 2 days");
  assert.equal(patientAgeLabel({address:{age_years:0,age_months:0,age_days:5}}),"5 days");
  assert.equal(patientAgeLabel({address:{age_years:0}}),"0 years");
  assert.equal(patientAgeParts({}),null);
});
test("entered age overrides legacy DOB and remains available to reference rule matching",()=>{
  const address={age_years:20,age_months:0,age_days:0,age_recorded_at:"2026-10-08T00:00:00Z"};
  assert.equal(patientAgeLabel({address,date_of_birth:"1970-01-01"}),"20 years");
  assert.equal(patientAgeDays(address,new Date("2026-10-09T00:00:00Z")),7306);
  assert.equal(patientAgeDays({},new Date()),null);
  assert.equal(patientAgeDays({...address,age_years:0},new Date("2026-10-01T00:00:00Z")),null);
});
test("age validates all components and preserves omitted age as unknown",()=>{
  const schema=z.object(patientAgeFields);
  assert.deepEqual(schema.parse({}),{});
  assert.equal(schema.safeParse({age_years:-1}).success,false);
  assert.equal(schema.safeParse({age_years:151}).success,false);
  assert.equal(schema.safeParse({age_months:12}).success,false);
  assert.equal(schema.safeParse({age_days:31}).success,false);
});
