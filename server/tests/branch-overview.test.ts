import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {branchOverviewCountsSql} from '../src/branch-overview.js';

test('branch counts isolate hospitals and branches and deduplicate multi-branch doctors', async () => {
  const db=new PGlite();
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const tenant=id(1),otherTenant=id(2),branch=id(3),otherBranch=id(4),doctor=id(5);
  try {
    await db.exec(`CREATE TABLE users(id uuid,tenant_id uuid,branch_id uuid,role text);
      CREATE TABLE user_branch_access(user_id uuid,tenant_id uuid,branch_id uuid);
      CREATE TABLE role_work_items(tenant_id uuid,branch_id uuid,workspace text,kind text);`);
    for(const table of ['patients','clinical_appointments','ipd_admissions','departments','beds']) {
      await db.exec(`CREATE TABLE ${table}(tenant_id uuid,branch_id uuid)`);
      await db.query(`INSERT INTO ${table} VALUES($1,$2),($1,$3),($4,$2)`,[tenant,branch,otherBranch,otherTenant]);
    }
    await db.query("INSERT INTO users VALUES($1,$2,$3,'doctor'),($4,$2,$5,'doctor'),($6,$2,$3,'receptionist'),($7,$8,$3,'doctor')",[doctor,tenant,branch,id(6),otherBranch,id(7),id(8),otherTenant]);
    await db.query('INSERT INTO user_branch_access VALUES($1,$2,$3),($1,$2,$4),($5,$2,$3)',[doctor,tenant,branch,otherBranch,id(6)]);
    await db.query("INSERT INTO role_work_items VALUES($1,$2,'laboratory','orders'),($1,$2,'laboratory','Results'),($1,$2,'laboratory','settings'),($1,$2,'reception','orders'),($1,$3,'laboratory','orders'),($4,$2,'laboratory','orders')",[tenant,branch,otherBranch,otherTenant]);
    const result=await db.query(branchOverviewCountsSql,[tenant,branch]);
    assert.deepEqual(result.rows,[{doctors:2,patients:1,lab_orders:2,appointments:1,admissions:1,departments:1,beds:1}]);
    const empty=await db.query(branchOverviewCountsSql,[tenant,id(99)]);
    assert.ok(Object.values(empty.rows[0]).every(count=>count===0));
  } finally { await db.close(); }
});
