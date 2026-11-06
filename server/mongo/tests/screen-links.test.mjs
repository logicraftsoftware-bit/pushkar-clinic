import {test} from 'node:test';
import assert from 'node:assert/strict';
import {screenShareLink} from '../screen-links.mjs';
const secret='synthetic-secret-not-used-by-real-clinic';
const screen={tenant_id:'clinic-a',id:'screen-a',token_hash:'synthetic-random-seed-hash'};
test('a screen link remains stable when other screens are created or its label changes',()=>{
  const original=screenShareLink(screen,secret);
  screenShareLink({...screen,id:'screen-b'},secret);
  assert.deepEqual(screenShareLink({...screen,name:'Updated screen'},secret),original);
  assert.match(original.path,/^\/waiting\/[A-Za-z0-9_-]{43}$/);
  assert.ok(!original.path.includes(screen.id));
});
test('separate screens and credential replacements have separate links',()=>{
  const first=screenShareLink(screen,secret);
  for(const change of [{id:'screen-b'},{tenant_id:'clinic-b'},{token_hash:'replacement-seed'}]){
    const other=screenShareLink({...screen,...change},secret);
    assert.notEqual(first.path,other.path);assert.notEqual(first.hash,other.hash);
  }
});
