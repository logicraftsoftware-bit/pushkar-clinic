import {pool} from './db.js';
import {medicityDentalRetirementSql} from './medicity-dental-retirement.js';

const client=await pool.connect();
try{
  await client.query('BEGIN');
  await client.query(medicityDentalRetirementSql);
  const result=await client.query(`SELECT coalesce(sum(jsonb_array_length(snapshot->'branches')),0)::int branches,
    coalesce(sum(jsonb_array_length(snapshot->'departments')),0)::int departments FROM erp_catalog_retirements
    WHERE change_key='medicity-dental-centres-and-departments-20261029-v1'`);
  await client.query('COMMIT');
  console.log('Medicity dental retirement snapshot:',result.rows[0]);
}catch(error){await client.query('ROLLBACK');throw error;}
finally{client.release();await pool.end();}
