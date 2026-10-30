import {test} from 'node:test';
import assert from 'node:assert/strict';
import {escapeSearch} from '../search.mjs';
test('search metacharacters remain literal rather than changing query structure',()=>{
  for(const value of ['[',']','a+b','(a|b)','^name$','a.b','path'+String.fromCharCode(92)+'name','*','{name}','বাংলা']){
    const expression=new RegExp('^'+escapeSearch(value)+'$','u');assert.equal(expression.test(value),true);assert.equal(expression.test('unrelated value'),false);
  }
  assert.throws(()=>escapeSearch(String.fromCharCode(0)));
});
