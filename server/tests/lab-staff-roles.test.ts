import assert from "node:assert/strict";
import {test} from "node:test";
import {labStaffRoleCodes,labApprovalPermissions} from "../src/lab-staff-roles.js";
import {staffSaveBody} from "../src/staff-validation.js";

test("pathologist and technician roles can use the laboratory portal and review and approve reports",()=>{
  for(const role of ["PATHOLOGIST","LAB_TECHNICIAN"])assert.ok(labStaffRoleCodes.includes(role));
  for(const permission of ["lab.order.view","lab.result.create","lab.result.verify","menu.verification.view","menu.reports.view"])assert.ok(labApprovalPermissions.includes(permission));
  assert.ok(!labApprovalPermissions.includes("staff.create"));
  assert.ok(!labApprovalPermissions.includes("billing.refund"));
});

test("pathologist requires medical registration on creation and editing; technician does not",()=>{
  const base={first_name:"Test",last_name:"Staff",branch_ids:["11111111-1111-4111-8111-111111111111"],personal:{},employment:{},account:{}};
  for(const id of [undefined,"22222222-2222-4222-8222-222222222222"]){
    assert.equal(staffSaveBody.safeParse({...base,id,staff_type:"Pathologist",professional:{}}).success,false);
    assert.equal(staffSaveBody.parse({...base,id,staff_type:"Pathologist",professional:{medical_registration_number:" REG-123 "}}).professional.medical_registration_number,"REG-123");
    assert.equal(staffSaveBody.safeParse({...base,id,staff_type:"Lab Technician",professional:{}}).success,true);
  }
});
