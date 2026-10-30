import type {PoolClient} from 'pg';
import {referPharmacySchemaSql} from './refer-pharmacy-schema.js';
import {referPharmacySource} from './refer-pharmacy-source.js';

export async function importReferPharmacies(client:PoolClient){
  await client.query('BEGIN');
  try{
    await client.query("SELECT pg_advisory_xact_lock(hashtext('medicity-refer-pharmacy-import'))");
    await client.query(referPharmacySchemaSql);
    const targets=await client.query("SELECT id FROM hospitals WHERE deleted_at IS NULL AND lower(name) LIKE '%medicity%'");
    if(targets.rows.length!==1)throw Error('Expected exactly one Medicity hospital for pharmacy import');
    const tenant=targets.rows[0].id;
    let inserted=0;
    for(const row of referPharmacySource){
      const result=await client.query(`INSERT INTO hospital_refer_pharmacies(tenant_id,source_id,name,address,discount_percentage)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,source_id) DO NOTHING RETURNING id`,
        [tenant,row.source_id,row.name,row.address,row.discount_percentage]);
      inserted+=result.rowCount??0;
    }
    await client.query('COMMIT');
    return {source_rows:referPharmacySource.length,inserted,already_imported:referPharmacySource.length-inserted};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
