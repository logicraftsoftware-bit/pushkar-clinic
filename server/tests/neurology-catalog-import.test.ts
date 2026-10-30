import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadNeurologyCatalog,neurologyCatalogSchema} from '../src/neurology-catalog-import.js';
test('new clinic does not load an inherited neurology catalog',()=>{
  assert.throws(()=>loadNeurologyCatalog(),/No catalog is bundled/);
});
test('accepts a clinic-owned catalog and rejects negative prices',()=>{
  const catalog={source_file:'example.csv',sheet:'Tests',source_rows:1,excluded_blank_name_ids:[],tests:[{source_id:'example-1',name:'Example Test',category:'Example Category',price:100,source_row:2}]};
  assert.equal(neurologyCatalogSchema.parse(catalog).tests.length,1);
  assert.equal(neurologyCatalogSchema.safeParse({...catalog,tests:[{...catalog.tests[0],price:-1}]}).success,false);
});
