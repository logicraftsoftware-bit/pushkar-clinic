import test from 'node:test';
import assert from 'node:assert/strict';
import {withinJsonBudget} from '../json-budget.mjs';
test('input budgets reject oversized arrays, maps and deep objects before schema validation',()=>{
  assert.equal(withinJsonBudget({patients:Array.from({length:1000},()=>({name:'Synthetic',address:{city:'Test'}}))}),true);
  assert.equal(withinJsonBudget({items:Array(2001).fill(null)}),false);
  assert.equal(withinJsonBudget(Object.fromEntries(Array.from({length:2001},(_,index)=>[String(index),null]))),false);
  let deep={};for(let index=0;index<32;index++)deep={child:deep};assert.equal(withinJsonBudget(deep),false);
  assert.equal(withinJsonBudget({text:'123456'},{string:5}),false);
  assert.equal(withinJsonBudget({a:[1,2,3],b:[4,5,6]},{nodes:5}),false);
});
