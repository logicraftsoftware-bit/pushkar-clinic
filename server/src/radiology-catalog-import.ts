import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {z} from 'zod';

type Client={query:(sql:string,values?:any[])=>Promise<any>};
type Row=Record<string,any>;
export const radiologyCatalogSchema=z.object({
  source_file:z.string().min(1),sheet:z.string().min(1),source_rows:z.number().int().positive(),
  excluded_blank_name_ids:z.array(z.string().min(1)),
  tests:z.array(z.object({source_id:z.string().trim().min(1),name:z.string().trim().min(1),category:z.string().trim().min(1),price:z.number().finite().nonnegative(),source_row:z.number().int().min(2)})).min(1),
});
export function loadRadiologyCatalog(): z.infer<typeof radiologyCatalogSchema> {
  throw new Error('No catalog is bundled for this clinic. Supply a clinic-owned catalog explicitly.');
}
const key=(name:string)=>name.trim().replace(/\s+/g,' ').toLowerCase();
export function radiologyTargetBranches(branches:Row[]){
  const diagnostics=branches.filter(branch=>key(branch.name)==='medicity guwahati diagnostics');
  const exactHospital=branches.filter(branch=>key(branch.name)==='medicity guwahati hospital');
  const hospital=exactHospital.length?exactHospital:branches.filter(branch=>key(branch.name)==='medicity guwahati');
  if(diagnostics.length!==1||hospital.length!==1)throw new Error('Select exactly one Medicity Guwahati Diagnostics and one Medicity Guwahati Hospital branch');
  return [hospital[0]!,diagnostics[0]!];
}
export function planRadiologyCatalog(input:unknown,existing:Row[]=[]){
  const catalog=radiologyCatalogSchema.parse(input);
  const ids=catalog.tests.map(test=>test.source_id);
  if(new Set(ids).size!==ids.length)throw new Error('Duplicate radiology source IDs');
  if(catalog.source_rows!==ids.length+catalog.excluded_blank_name_ids.length)throw new Error('The spreadsheet row counts do not reconcile');
  if(catalog.excluded_blank_name_ids.some(id=>ids.includes(id)))throw new Error('Excluded source IDs cannot also be imported');
  const counts=new Map<string,number>(),used=new Set(existing.map(row=>key(row.name)));
  for(const test of catalog.tests)counts.set(key(test.name),(counts.get(key(test.name))||0)+1);
  const tests=catalog.tests.map(test=>{
    const matches=existing.filter(row=>row.data?.radiology_source_id===test.source_id&&row.data?.radiology_import?.source_file===catalog.source_file);
    if(matches.length>1)throw new Error(`Multiple existing masters match radiology source ${test.source_id}`);
    if(matches.length)return {...test,display_name:String(matches[0]!.name),existing_id:String(matches[0]!.id)};
    const base=counts.get(key(test.name))!>1||used.has(key(test.name))?`${test.name} [RAD-${test.source_id}]`:test.name;
    let displayName=base,index=2;
    while(used.has(key(displayName)))displayName=`${base} (${index++})`;
    used.add(key(displayName));
    return {...test,display_name:displayName,existing_id:null};
  });
  return {catalog,tests,categories:[...new Set(catalog.tests.map(test=>test.category))]};
}

// The caller owns the transaction. The startup schema transaction and CLI both
// use this helper, so a failed import never leaves part of the catalogue behind.
export async function importRadiologyCatalog(client:Client,input:unknown,tenantId?:string){
  const validated=planRadiologyCatalog(input).catalog;
  const candidates=tenantId
    ?await client.query('SELECT id tenant_id FROM hospitals WHERE id=$1 AND deleted_at IS NULL',[z.string().uuid().parse(tenantId)])
    :await client.query(`SELECT h.id tenant_id FROM hospitals h WHERE h.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM branches b WHERE b.tenant_id=h.id AND b.is_active=true AND lower(trim(b.name))='medicity guwahati diagnostics')
      AND EXISTS(SELECT 1 FROM branches b WHERE b.tenant_id=h.id AND b.is_active=true AND lower(trim(b.name)) IN ('medicity guwahati hospital','medicity guwahati'))`);
  if(candidates.rows.length!==1){
    if(tenantId)throw new Error('The selected hospital is unavailable');
    return {skipped:candidates.rows.length?'Multiple Medicity hospitals found; select --tenant explicitly':'Medicity target branch pair not present'};
  }
  const tenant=String(candidates.rows[0].tenant_id),sourceKey='medicity-radiology-tests-20261026-v2';
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${sourceKey}:${tenant}`]);
  await client.query(`CREATE TABLE IF NOT EXISTS radiology_catalog_imports(
    tenant_id uuid NOT NULL,source_key text NOT NULL,source_hash text NOT NULL,summary jsonb NOT NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(tenant_id,source_key))`);
  const previous=await client.query('SELECT summary FROM radiology_catalog_imports WHERE tenant_id=$1 AND source_key=$2',[tenant,sourceKey]);
  if(previous.rows.length)return {skipped:'Already imported; subsequent master edits preserved',...previous.rows[0].summary};
  const branches=radiologyTargetBranches((await client.query('SELECT id,name,code FROM branches WHERE tenant_id=$1 AND is_active=true ORDER BY code,id',[tenant])).rows);
  const existing=(await client.query("SELECT id,name,data FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='test' ORDER BY id FOR UPDATE",[tenant])).rows;
  const plan=planRadiologyCatalog(validated,existing);
  const existingById=new Map<string,Row>(existing.map((row:Row)=>[String(row.id),row]));
  function branchScope(data:Row,price:number){
    const prices=Object.fromEntries(branches.map(branch=>[branch.id,data.branch_prices?.[branch.id]??data.amount??price]));
    const taxes=Object.fromEntries(branches.map(branch=>[branch.id,data.branch_tax_percentages?.[branch.id]??data.tax_percentage??0]));
    return {available_branch_ids:branches.map(branch=>branch.id),branch_prices:prices,branch_tax_percentages:taxes,
      branch_standard_charges:Object.fromEntries(branches.map(branch=>[branch.id,data.branch_standard_charges?.[branch.id]??Number(prices[branch.id])/(1+Number(taxes[branch.id])/100)]))};
  }
  const scopedExisting=plan.tests.filter(test=>test.existing_id).map(test=>({id:test.existing_id,data:branchScope(existingById.get(test.existing_id!)!.data||{},test.price)}));
  if(scopedExisting.length)await client.query(`UPDATE hospital_diagnostic_masters m SET data=m.data||x.data,updated_at=now()
    FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,data jsonb) WHERE m.tenant_id=$1 AND m.id=x.id AND m.domain='pathology' AND m.kind='test'`,[tenant,JSON.stringify(scopedExisting)]);
  const categories=(await client.query("SELECT id,name FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain='pathology' AND kind='category' ORDER BY id",[tenant])).rows;
  const categoryIds=new Map<string,string>(categories.map((row:Row)=>[key(row.name),String(row.id)]));
  for(const name of plan.categories){
    if(categoryIds.has(key(name)))continue;
    const result=await client.query("INSERT INTO hospital_diagnostic_masters(tenant_id,domain,kind,name,data) VALUES($1,'pathology','category',$2,$3) RETURNING id",[tenant,name,JSON.stringify({test_type:'Radiology',source_file:validated.source_file})]);
    categoryIds.set(key(name),String(result.rows[0].id));
  }
  const create=plan.tests.filter(test=>!test.existing_id).map(test=>({name:test.display_name,data:{
    test_type:'Radiology',short_name:`RAD-${test.source_id}`,category_id:categoryIds.get(key(test.category)),
    source_name:test.name,radiology_source_id:test.source_id,
    amount:test.price,standard_charge:test.price,tax_percentage:0,
    ...branchScope({},test.price),
    parameter_ids:[],container_ids:[],report_days:0,
    radiology_import:{source_file:validated.source_file,sheet:validated.sheet,id:test.source_id,row:test.source_row,price:test.price},
  }}));
  if(create.length)await client.query(`INSERT INTO hospital_diagnostic_masters(tenant_id,domain,kind,name,data)
    SELECT $1,'pathology','test',x.name,x.data FROM jsonb_to_recordset($2::jsonb) AS x(name text,data jsonb)`,[tenant,JSON.stringify(create)]);
  const verified=(await client.query(`SELECT count(*)::int count FROM hospital_diagnostic_masters
    WHERE tenant_id=$1 AND domain='pathology' AND kind='test' AND data->>'test_type'='Radiology'
      AND data->'radiology_import'->>'source_file'=$2 AND data->>'radiology_source_id'=ANY($3::text[])`,[tenant,validated.source_file,validated.tests.map(test=>test.source_id)])).rows[0].count;
  if(verified!==validated.tests.length)throw new Error('Radiology import verification failed');
  const summary={tenant_id:tenant,source_rows:validated.source_rows,imported_tests:verified,created:create.length,existing:plan.tests.length-create.length,
    categories:plan.categories.length,branches:branches.map((branch:Row)=>branch.name),excluded_blank_name_ids:validated.excluded_blank_name_ids};
  await client.query('INSERT INTO radiology_catalog_imports(tenant_id,source_key,source_hash,summary) VALUES($1,$2,$3,$4)',[tenant,sourceKey,createHash('sha256').update(JSON.stringify(validated)).digest('hex'),JSON.stringify(summary)]);
  return summary;
}
