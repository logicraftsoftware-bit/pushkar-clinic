import test from 'node:test';
import assert from 'node:assert/strict';
import {databaseDiagnostic} from '../database-diagnostics.mjs';
test('database diagnostics distinguish failures without exposing connection secrets',()=>{
  const secret='mongodb+srv://private:password@example.invalid';
  for(const [code,message,pattern] of [[18,secret,/authentication/],[8000,'bad auth '+secret,/authentication/],[13,secret,/permission denied/],[85,secret,/index/],[11000,secret,/Duplicate/]]){
    const result=databaseDiagnostic({code,message,initializationStage:'indexes:users'});assert.equal(result.code,code);assert.equal(result.stage,'indexes:users');assert.match(result.hint,pattern);assert.equal(JSON.stringify(result).includes(secret),false);
  }
  assert.equal(databaseDiagnostic({initializationStage:secret,message:secret}).stage,'backend-import');
});
