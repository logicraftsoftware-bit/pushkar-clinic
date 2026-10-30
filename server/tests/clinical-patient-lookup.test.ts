import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clinicalPatientLookupSql,clinicalPatientEligibilitySql} from '../src/clinical-patient-lookup.js';

test('existing-patient lookup includes every hospital branch and excludes deleted patients',()=>{
  assert.match(clinicalPatientLookupSql,/WHERE tenant_id=\$1 AND deleted_at IS NULL/);
  assert.doesNotMatch(clinicalPatientLookupSql,/branch_id\s*=|ANY\(|LIMIT/);
  assert.match(clinicalPatientLookupSql,/registration_fee/);assert.match(clinicalPatientLookupSql,/medical_record_number/);
});
test('appointment patient validation permits any registration branch but prevents other hospital IDs',()=>{
  assert.match(clinicalPatientEligibilitySql,/id=\$1 AND tenant_id=\$2 AND deleted_at IS NULL/);
  assert.doesNotMatch(clinicalPatientEligibilitySql,/branch_id/);
});
