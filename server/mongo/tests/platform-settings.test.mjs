import test from 'node:test';
import assert from 'node:assert/strict';
import {platformSettingsWithDefaults} from '../platform-settings.mjs';

test('fresh databases expose editable settings and Pushkar branding',()=>{
  const rows=platformSettingsWithDefaults([]);
  assert.equal(rows.length,6);
  assert.equal(rows.find(row=>row.key==='platform_name').value,'Pushkar Clinic ERP');
  assert.equal(rows.find(row=>row.key==='platform_logo').category,'branding');
});

test('saved values remain authoritative and missing descriptions receive defaults',()=>{
  const saved=[{key:'platform_name',value:'My clinic',category:'branding'},{key:'trial_days',value:0}];
  const rows=platformSettingsWithDefaults(saved);
  assert.equal(rows.find(row=>row.key==='platform_name').value,'My clinic');
  assert.equal(rows.find(row=>row.key==='trial_days').value,0);
  assert.ok(rows.find(row=>row.key==='platform_name').description);
  assert.equal(saved[0].description,undefined);
});
