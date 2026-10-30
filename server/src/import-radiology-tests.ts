import {parseArgs} from 'node:util';
import {basename} from 'node:path';
import {importRadiologyCatalog,loadRadiologyCatalog} from './radiology-catalog-import.js';
const {values}=parseArgs({options:{mode:{type:'string',default:'preview'},env:{type:'string',default:process.env.ENV_FILE??(basename(process.cwd())==='server'?'../.env':'.env')},tenant:{type:'string'}}});
if(!['preview','apply'].includes(values.mode!))throw new Error('Use --mode preview or --mode apply');
process.env.ENV_FILE=values.env;
const {pool}=await import('./db.js');
const client=await pool.connect();
try{
  await client.query('BEGIN');
  const result=await importRadiologyCatalog(client,loadRadiologyCatalog(),values.tenant);
  await client.query(values.mode==='apply'?'COMMIT':'ROLLBACK');
  console.log(JSON.stringify({mode:values.mode,...result},null,2));
}catch(error){await client.query('ROLLBACK');throw error;}
finally{client.release();await pool.end();}
