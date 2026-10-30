import {pool} from './db.js';
import {medicityDepartmentSyncSql} from './medicity-departments.js';

const client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('medicity-department-sync'))");
  const result=await client.query(medicityDepartmentSyncSql);
  await client.query('COMMIT');
  console.log(`Medicity department sync: ${result.rowCount} branch departments added`);
} catch(error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
