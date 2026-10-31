import {branchOverviewCountsSql} from './branch-overview.js';
import {diagnosticTestType} from './diagnostic-master-unification.js';
import {referPharmacySchemaSql} from './refer-pharmacy-schema.js';
import {roleLabel} from './role-label.js';
import { Router, type NextFunction, type Request, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { config } from './config.js'
import { pool } from './db.js'
import { hasPermission } from './access-control.js'
import { replaceUserBranchAccess, accessibleBranchIds } from './branch-access.js'
import { configuredPrefix } from './settings-runtime.js'
import { staffSaveBody, staffAccountActive } from './staff-validation.js'
import {printTemplateBody} from './print-template-validation.js'
import {validateLabPrices} from './lab-price-validation.js'

type PortalAuth = { sub:string;tenantId:string;branchId:string;role:string }
type AuthedRequest = Request & { portalUser?: PortalAuth }
const router = Router()
let schemaReady: Promise<unknown> | null = null
function ensureSchema() {
  schemaReady ??= pool.query(`
    ${referPharmacySchemaSql}
    ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS establishment_date date;
    ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS website text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS branch_type text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS manager_name text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS email citext;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS emergency_phone text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS address_line text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS city text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS state text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS pin_code text;
    ALTER TABLE branches ADD COLUMN IF NOT EXISTS bed_capacity integer NOT NULL DEFAULT 0;
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS hod_name text;
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS location text;
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS phone_extension text;
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
    ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    CREATE TABLE IF NOT EXISTS wards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES branches(id), department_id uuid REFERENCES departments(id), name text NOT NULL,
      code citext NOT NULL, ward_type text, floor text, capacity integer NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,code));
    CREATE TABLE IF NOT EXISTS rooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES branches(id), ward_id uuid REFERENCES wards(id), room_number text NOT NULL, room_type text,
      floor text, daily_charge numeric(12,2) NOT NULL DEFAULT 0, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,branch_id,room_number));
    CREATE TABLE IF NOT EXISTS beds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      branch_id uuid NOT NULL REFERENCES branches(id), ward_id uuid REFERENCES wards(id), room_id uuid REFERENCES rooms(id),
      bed_number text NOT NULL, bed_type text, daily_charge numeric(12,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'Available' CHECK(status IN ('Available','Occupied','Reserved','Cleaning','Maintenance')),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,branch_id,bed_number));
    CREATE TABLE IF NOT EXISTS bed_masters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK(kind IN ('type','group','floor')), name text NOT NULL, description text NOT NULL DEFAULT '', color text,
      floor_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,kind,name));
    ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_type_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT;
    ALTER TABLE beds ADD COLUMN IF NOT EXISTS bed_group_id uuid REFERENCES bed_masters(id) ON DELETE RESTRICT;
    CREATE INDEX IF NOT EXISTS idx_bed_masters_tenant_kind ON bed_masters(tenant_id,kind);
    CREATE TABLE IF NOT EXISTS hospital_charge_masters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK(kind IN ('charge','category','type','tax','unit')), name text NOT NULL,
      parent_id uuid REFERENCES hospital_charge_masters(id) ON DELETE RESTRICT, percentage numeric(7,2),
      modules text[] NOT NULL DEFAULT '{}', data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,kind,name));
    CREATE TABLE IF NOT EXISTS hospital_print_templates (
      tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE, document_type text NOT NULL,
      header_image text, footer_content text NOT NULL DEFAULT '', updated_by uuid REFERENCES users(id),
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,document_type));
    CREATE TABLE IF NOT EXISTS hospital_operation_masters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK(kind IN ('operation','category')), name text NOT NULL,
      category_id uuid REFERENCES hospital_operation_masters(id) ON DELETE RESTRICT,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(tenant_id,kind,name));
    CREATE TABLE IF NOT EXISTS hospital_pharmacy_masters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK(kind IN ('category','supplier','dosage','interval','duration','unit','company','group','medicine')),
      name text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,kind,name));
    ALTER TABLE hospital_pharmacy_masters DROP CONSTRAINT IF EXISTS hospital_pharmacy_masters_kind_check;
    ALTER TABLE hospital_pharmacy_masters ADD CONSTRAINT hospital_pharmacy_masters_kind_check CHECK(kind IN ('category','supplier','dosage','interval','duration','unit','company','group','medicine'));
    CREATE TABLE IF NOT EXISTS hospital_diagnostic_masters (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      domain text NOT NULL CHECK(domain IN ('radiology','blood','symptoms')), kind text NOT NULL,
      name text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,domain,kind,name));
    ALTER TABLE hospital_diagnostic_masters DROP CONSTRAINT IF EXISTS hospital_diagnostic_masters_domain_check;
    ALTER TABLE hospital_diagnostic_masters ADD CONSTRAINT hospital_diagnostic_masters_domain_check CHECK(domain IN ('pathology','radiology','blood','symptoms'));
    ALTER TABLE users ADD COLUMN IF NOT EXISTS username citext;
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'accountant';
    ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'hr';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_change boolean NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled boolean NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS account_expires_at date;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username ON users(tenant_id,username) WHERE username IS NOT NULL;
    CREATE TABLE IF NOT EXISTS staff_members (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
      user_id uuid REFERENCES users(id) ON DELETE SET NULL, employee_id text NOT NULL, first_name text NOT NULL,
      middle_name text, last_name text NOT NULL, profile_photo text, staff_type text NOT NULL,
      branch_id uuid REFERENCES branches(id), department_id uuid REFERENCES departments(id), designation text,
      employment_type text, joining_date date, status text NOT NULL DEFAULT 'Active',
      personal jsonb NOT NULL DEFAULT '{}', employment jsonb NOT NULL DEFAULT '{}', account jsonb NOT NULL DEFAULT '{}',
      professional jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,employee_id));

    UPDATE staff_members SET staff_type='Pharmacy Manager' WHERE staff_type='Pharmacist';
    UPDATE staff_members SET staff_type='HR Manager' WHERE staff_type='HR';
  `)
  return schemaReady
}

function authenticate(request: AuthedRequest, response: Response, next: NextFunction) {
  const token = request.header('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) { response.status(401).json({ error:'Authentication required' }); return }
  try {
    const payload = jwt.verify(token, config.JWT_SECRET, {
      issuer:'careframe-api', audience:'careframe-portal',
    }) as PortalAuth
    request.portalUser = payload
    next()
  } catch {
    response.status(401).json({ error:'Session expired or invalid' })
  }
}
router.use(authenticate)
router.use('/diagnostic-masters/radiology', (_request,response)=>{
  response.status(410).json({error:'Radiology test masters have moved to Pathology & Radiology. Use the shared pathology master.'});
});
router.use(async (request:AuthedRequest,response,next)=>{
  const staff=request.path.startsWith('/staff')
  const action=request.method==='GET'?'view':request.method==='DELETE'?'delete':request.body?.id?'update':'create'
  const pharmacy=request.path.startsWith('/pharmacy-masters')
  const diagnostic=request.path.startsWith('/diagnostic-masters')||request.path==='/diagnostic-branches',radiologyDiagnostic=request.path.startsWith('/diagnostic-masters/radiology/')
  const chargeRead=request.method==='GET'&&request.path.startsWith('/charge-masters')
  const codes=staff?[`staff.${action}`]:pharmacy?[request.method==='GET'?'pharmacy.view':'pharmacy.inventory.manage']:radiologyDiagnostic?[request.method==='GET'?'radiology.view':'radiology.report.create']:diagnostic?(request.method==='GET'?['lab.order.view','radiology.view']:['lab.result.create','radiology.report.create']):chargeRead?['lab.order.view','radiology.view']:['hospital.manage']
  const allowed=(await Promise.all(codes.map(code=>hasPermission(request.portalUser!.sub,request.portalUser!.tenantId,code)))).some(Boolean)
  if(!allowed){response.status(403).json({error:`Permission required: ${codes.join(' or ')}`});return}
  next()
})
router.use(async (_request, response, next) => {
  try { await ensureSchema(); next() }
  catch (error) { schemaReady = null; next(error) }
})

const resources = {
  'refer-pharmacies': { table:'hospital_refer_pharmacies', columns:['name','address','discount_percentage'] },
  branches: { table:'branches', columns:['name','code','branch_type','manager_name','email','phone','emergency_phone','address_line','city','state','pin_code','bed_capacity','is_active'] },
  departments: { table:'departments', columns:['name','code','branch_id','hod_name','location','phone_extension','description','is_active'] },
  wards: { table:'wards', columns:['name','code','branch_id','department_id','ward_type','floor','capacity','is_active'] },
  rooms: { table:'rooms', columns:['room_number','branch_id','ward_id','room_type','floor','daily_charge','is_active'] },
  beds: { table:'beds', columns:['bed_number','branch_id','ward_id','room_id','bed_type','bed_type_id','bed_group_id','daily_charge','status'] },
} as const
type Resource = keyof typeof resources
const resourceName = z.enum(['branches','departments','wards','rooms','beds','refer-pharmacies'])
const referenceTables: Record<string,string> = {
  branch_id:'branches', department_id:'departments', ward_id:'wards', room_id:'rooms',
}
const resourceValue = (key:string, value:unknown) =>
  value === '' && key in referenceTables ? null : value
const optionalTenDigitPhone = z.string().trim().regex(/^\d{10}$/, 'Phone number must contain exactly 10 digits').or(z.literal(''))
const optionalPhoneExtension = z.string().trim().regex(/^\d{1,10}$/, 'Phone / extension must contain numbers only (maximum 10 digits)').or(z.literal(''))
function validateResourceFields(resource:Resource, body:Record<string,unknown>) {
  if(resource==='refer-pharmacies'){
    body.name=z.string().trim().min(1,'Pharmacy name is required').max(200).parse(body.name)
    body.address=z.string().trim().min(1,'Address is required').max(2000).parse(body.address)
    body.discount_percentage=z.coerce.number().finite().min(0).max(100).multipleOf(0.01).parse(body.discount_percentage)
  }
  if(resource==='branches'){
    if('phone' in body)body.phone=optionalTenDigitPhone.parse(body.phone)
    if('emergency_phone' in body)body.emergency_phone=optionalTenDigitPhone.parse(body.emergency_phone)
  }
  if(resource==='departments'&&'phone_extension' in body)
    body.phone_extension=optionalPhoneExtension.parse(body.phone_extension)
}
async function validateTenantReferences(body: Record<string,unknown>, tenantId:string) {
  for (const [field,table] of Object.entries(referenceTables)) {
    const value = body[field]
    if (!value) continue
    const valid = await pool.query(`SELECT 1 FROM ${table} WHERE id=$1 AND tenant_id=$2`, [value,tenantId])
    if (!valid.rowCount) throw new Error(`Invalid ${field.replace('_id','')} selection`)
  }
}
async function validateBedLocation(body: Record<string,unknown>, tenantId:string) {
  const branchId=body.branch_id,wardId=body.ward_id,roomId=body.room_id
  if(!wardId||!roomId)throw new Error('Ward and room are required for every bed')
  if(wardId){
    const ward=await pool.query(`SELECT branch_id FROM wards WHERE id=$1 AND tenant_id=$2`,[wardId,tenantId])
    if(!ward.rows[0]||ward.rows[0].branch_id!==branchId)throw new Error('Selected ward does not belong to the bed branch')
  }
  if(roomId){
    const room=await pool.query(`SELECT branch_id,ward_id FROM rooms WHERE id=$1 AND tenant_id=$2`,[roomId,tenantId])
    if(!room.rows[0]||room.rows[0].branch_id!==branchId)throw new Error('Selected room does not belong to the bed branch')
    if(wardId&&room.rows[0].ward_id!==wardId)throw new Error('Selected room does not belong to the selected ward')
  }
}
async function validateWardLocation(body: Record<string,unknown>, tenantId:string) {
  const branchId=body.branch_id,departmentId=body.department_id
  if(!branchId)throw new Error('Branch is required for every ward')
  if(departmentId){
    const department=await pool.query(`SELECT branch_id FROM departments WHERE id=$1 AND tenant_id=$2`,[departmentId,tenantId])
    if(!department.rows[0]||department.rows[0].branch_id!==branchId)throw new Error('Selected department does not belong to the ward branch')
  }
}
async function validateRoomLocation(body: Record<string,unknown>, tenantId:string) {
  const branchId=body.branch_id,wardId=body.ward_id
  if(!branchId||!wardId)throw new Error('Branch and ward are required for every room')
  const ward=await pool.query(`SELECT branch_id FROM wards WHERE id=$1 AND tenant_id=$2`,[wardId,tenantId])
  if(!ward.rows[0]||ward.rows[0].branch_id!==branchId)throw new Error('Selected ward does not belong to the room branch')
}

const bedMasterKind = z.enum(['type','group','floor'])
const bedMasterBody = z.object({
  name:z.string().trim().min(1), description:z.string().optional().prefault(''), color:z.string().optional().nullable(),
  floor_id:z.string().uuid().optional().nullable(),
})
async function validateBedFloor(tenantId:string, floorId:string|null|undefined) {
  if (!floorId) return
  const floor=await pool.query(`SELECT 1 FROM bed_masters WHERE id=$1 AND tenant_id=$2 AND kind='floor'`,[floorId,tenantId])
  if(!floor.rowCount) throw new Error('Invalid floor selection')
}
router.get('/bed-setup/:kind',async(request:AuthedRequest,response)=>{
  if(request.params.kind==='status'){
    const result=await pool.query(`SELECT b.id,b.bed_number,b.status,br.name branch,w.name ward,rm.room_number,bt.name bed_type,bg.name bed_group,bg.color bed_group_color,f.name floor,b.updated_at FROM beds b LEFT JOIN branches br ON br.id=b.branch_id LEFT JOIN wards w ON w.id=b.ward_id LEFT JOIN rooms rm ON rm.id=b.room_id LEFT JOIN bed_masters bt ON bt.id=b.bed_type_id LEFT JOIN bed_masters bg ON bg.id=b.bed_group_id LEFT JOIN bed_masters f ON f.id=bg.floor_id WHERE b.tenant_id=$1 ORDER BY b.bed_number`,[request.portalUser!.tenantId])
    response.json(result.rows); return
  }
  const kind=bedMasterKind.parse(request.params.kind)
  const result=await pool.query(`SELECT m.*,f.name floor_name FROM bed_masters m LEFT JOIN bed_masters f ON f.id=m.floor_id AND f.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.kind=$2 ORDER BY m.name`,[request.portalUser!.tenantId,kind])
  response.json(result.rows)
})
router.post('/bed-setup/:kind',async(request:AuthedRequest,response)=>{
  const kind=bedMasterKind.parse(request.params.kind),body=bedMasterBody.parse(request.body),tenantId=request.portalUser!.tenantId
  if(kind==='group') await validateBedFloor(tenantId,body.floor_id)
  const result=await pool.query(`INSERT INTO bed_masters(tenant_id,kind,name,description,color,floor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[tenantId,kind,body.name,body.description,body.color||null,kind==='group'?body.floor_id||null:null])
  response.status(201).json(result.rows[0])
})
router.put('/bed-setup/:kind/:id',async(request:AuthedRequest,response)=>{
  const kind=bedMasterKind.parse(request.params.kind),body=bedMasterBody.parse(request.body),tenantId=request.portalUser!.tenantId
  if(kind==='group') await validateBedFloor(tenantId,body.floor_id)
  const result=await pool.query(`UPDATE bed_masters SET name=$1,description=$2,color=$3,floor_id=$4,updated_at=now() WHERE id=$5 AND tenant_id=$6 AND kind=$7 RETURNING *`,[body.name,body.description,body.color||null,kind==='group'?body.floor_id||null:null,request.params.id,tenantId,kind])
  if(!result.rows[0]){response.status(404).json({error:'Record not found'});return} response.json(result.rows[0])
})
router.delete('/bed-setup/:kind/:id',async(request:AuthedRequest,response)=>{
  const kind=bedMasterKind.parse(request.params.kind)
  const result=await pool.query(`DELETE FROM bed_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3 RETURNING id`,[request.params.id,request.portalUser!.tenantId,kind])
  if(!result.rows[0]){response.status(404).json({error:'Record not found or is in use'});return} response.status(204).end()
})

router.get('/profile', async (request: AuthedRequest, response) => {
  const result = await pool.query(
    `SELECT id,name,code,logo_url,hospital_type,registration_number,establishment_date,
      email,phone,emergency_phone,website,gstin,address_line,city,state,pin_code,country,currency,timezone
     FROM hospitals WHERE id=$1 AND deleted_at IS NULL`,
    [request.portalUser!.tenantId],
  )
  response.json(result.rows[0])
})

router.put('/profile', async (request: AuthedRequest, response) => {
  const allowed = ['name','code','logo_url','hospital_type','registration_number','establishment_date','email','phone','emergency_phone','website','gstin','address_line','city','state','pin_code','country','currency','timezone']
  const body = z.record(z.string(), z.unknown()).parse(request.body)
  const entries = allowed.filter(key => key in body).map(key => [key, body[key]] as const)
  if (!entries.length) { response.status(400).json({ error:'No profile fields supplied' }); return }
  const set = entries.map(([key], index) => `${key}=$${index + 2}`).join(',')
  const result = await pool.query(`UPDATE hospitals SET ${set},updated_at=now() WHERE id=$1 RETURNING *`,
    [request.portalUser!.tenantId, ...entries.map(([,value]) => value === '' ? null : value)])
  response.json(result.rows[0])
})

const chargeKind = z.enum(['charge','category','type','tax','unit'])
const chargeMasterBody = z.object({
  name:z.string().trim().min(1), parent_id:z.string().uuid().nullable().optional(),
  percentage:z.coerce.number().min(0).max(100).nullable().optional(), modules:z.array(z.string()).optional().prefault([]),
  data:z.record(z.string(),z.unknown()).optional().prefault({}),
})
async function validateChargeReferences(tenantId:string, body:z.infer<typeof chargeMasterBody>) {
  const ids=[body.parent_id,...['charge_type_id','category_id','unit_type_id','tax_category_id'].map(key=>body.data[key])]
    .filter(Boolean) as string[]
  if(!ids.length)return
  const valid=await pool.query(`SELECT count(*)::int count FROM hospital_charge_masters WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[tenantId,ids])
  if(valid.rows[0].count!==new Set(ids).size)throw new Error('Invalid hospital charge selection')
}
router.get('/charge-masters/:kind', async(request:AuthedRequest,response)=>{
  const kind=chargeKind.parse(request.params.kind)
  const result=await pool.query(`SELECT m.*,p.name parent_name FROM hospital_charge_masters m LEFT JOIN hospital_charge_masters p ON p.id=m.parent_id AND p.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.kind=$2 ORDER BY m.created_at DESC`,[request.portalUser!.tenantId,kind])
  response.json(result.rows)
})
router.post('/charge-masters/:kind', async(request:AuthedRequest,response)=>{
  const kind=chargeKind.parse(request.params.kind),body=chargeMasterBody.parse(request.body),tenantId=request.portalUser!.tenantId
  await validateChargeReferences(tenantId,body)
  const result=await pool.query(`INSERT INTO hospital_charge_masters(tenant_id,kind,name,parent_id,percentage,modules,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[tenantId,kind,body.name,body.parent_id||null,body.percentage??null,body.modules,body.data])
  response.status(201).json(result.rows[0])
})
router.put('/charge-masters/:kind/:id', async(request:AuthedRequest,response)=>{
  const kind=chargeKind.parse(request.params.kind),body=chargeMasterBody.parse(request.body),tenantId=request.portalUser!.tenantId
  await validateChargeReferences(tenantId,body)
  const result=await pool.query(`UPDATE hospital_charge_masters SET name=$1,parent_id=$2,percentage=$3,modules=$4,data=$5,updated_at=now() WHERE id=$6 AND tenant_id=$7 AND kind=$8 RETURNING *`,[body.name,body.parent_id||null,body.percentage??null,body.modules,body.data,request.params.id,tenantId,kind])
  if(!result.rows[0]){response.status(404).json({error:'Record not found'});return} response.json(result.rows[0])
})
router.delete('/charge-masters/:kind/:id', async(request:AuthedRequest,response)=>{
  const kind=chargeKind.parse(request.params.kind),tenantId=request.portalUser!.tenantId,client=await pool.connect()
  try {
    await client.query('BEGIN')
    const existing=await client.query(`SELECT id FROM hospital_charge_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3 FOR UPDATE`,[request.params.id,tenantId,kind])
    if(!existing.rows[0]){await client.query('ROLLBACK');response.status(404).json({error:'Record not found'});return}
    if(kind==='type')await client.query(`UPDATE hospital_charge_masters SET parent_id=null,data=data-'charge_type_id',updated_at=now() WHERE tenant_id=$1 AND (parent_id=$2::uuid OR data->>'charge_type_id'=$2::text)`,[tenantId,request.params.id])
    if(kind==='category')await client.query(`UPDATE hospital_charge_masters SET data=data-'category_id',updated_at=now() WHERE tenant_id=$1 AND data->>'category_id'=$2`,[tenantId,request.params.id])
    if(kind==='unit')await client.query(`UPDATE hospital_charge_masters SET data=data-'unit_type_id',updated_at=now() WHERE tenant_id=$1 AND data->>'unit_type_id'=$2`,[tenantId,request.params.id])
    if(kind==='tax')await client.query(`UPDATE hospital_charge_masters SET data=data-'tax_category_id',updated_at=now() WHERE tenant_id=$1 AND data->>'tax_category_id'=$2`,[tenantId,request.params.id])
    await client.query(`DELETE FROM hospital_charge_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3`,[request.params.id,tenantId,kind])
    await client.query('COMMIT');response.status(204).end()
  } catch(error) {await client.query('ROLLBACK');throw error} finally {client.release()}
})
router.get('/print-templates/:document',async(request:AuthedRequest,response)=>{
  const document=String(request.params.document??'').trim()
  const result=await pool.query(`SELECT document_type,header_image,footer_content,updated_at FROM hospital_print_templates WHERE tenant_id=$1 AND document_type=$2`,[request.portalUser!.tenantId,document])
  response.json(result.rows[0]??{document_type:document,header_image:'',footer_content:''})
})
router.put('/print-templates/:document',async(request:AuthedRequest,response)=>{
  const document=String(request.params.document??'').trim()
  const body=printTemplateBody.parse(request.body)
  const result=await pool.query(`INSERT INTO hospital_print_templates(tenant_id,document_type,header_image,footer_content,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,document_type) DO UPDATE SET header_image=excluded.header_image,footer_content=excluded.footer_content,updated_by=excluded.updated_by,updated_at=now() RETURNING document_type,header_image,footer_content,updated_at`,[request.portalUser!.tenantId,document,body.header_image||null,body.footer_content,request.portalUser!.sub])
  response.json(result.rows[0])
})
const operationKind=z.enum(['operation','category'])
const operationBody=z.object({name:z.string().trim().min(1),category_id:z.string().uuid().nullable().optional()})
router.get('/operation-masters/:kind',async(request:AuthedRequest,response)=>{
  const kind=operationKind.parse(request.params.kind)
  const result=await pool.query(`SELECT m.*,c.name category_name FROM hospital_operation_masters m LEFT JOIN hospital_operation_masters c ON c.id=m.category_id AND c.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.kind=$2 ORDER BY m.created_at DESC`,[request.portalUser!.tenantId,kind])
  response.json(result.rows)
})
router.post('/operation-masters/:kind',async(request:AuthedRequest,response)=>{
  const kind=operationKind.parse(request.params.kind),body=operationBody.parse(request.body),tenantId=request.portalUser!.tenantId
  if(kind==='operation'&&!body.category_id){response.status(400).json({error:'Operation category is required'});return}
  if(body.category_id){const valid=await pool.query(`SELECT 1 FROM hospital_operation_masters WHERE id=$1 AND tenant_id=$2 AND kind='category'`,[body.category_id,tenantId]);if(!valid.rowCount){response.status(400).json({error:'Invalid operation category'});return}}
  const result=await pool.query(`INSERT INTO hospital_operation_masters(tenant_id,kind,name,category_id) VALUES($1,$2,$3,$4) RETURNING *`,[tenantId,kind,body.name,kind==='operation'?body.category_id:null])
  response.status(201).json(result.rows[0])
})
router.put('/operation-masters/:kind/:id',async(request:AuthedRequest,response)=>{
  const kind=operationKind.parse(request.params.kind),body=operationBody.parse(request.body),tenantId=request.portalUser!.tenantId
  if(kind==='operation'&&!body.category_id){response.status(400).json({error:'Operation category is required'});return}
  if(body.category_id){const valid=await pool.query(`SELECT 1 FROM hospital_operation_masters WHERE id=$1 AND tenant_id=$2 AND kind='category'`,[body.category_id,tenantId]);if(!valid.rowCount){response.status(400).json({error:'Invalid operation category'});return}}
  const result=await pool.query(`UPDATE hospital_operation_masters SET name=$1,category_id=$2,updated_at=now() WHERE id=$3 AND tenant_id=$4 AND kind=$5 RETURNING *`,[body.name,kind==='operation'?body.category_id:null,request.params.id,tenantId,kind])
  if(!result.rows[0]){response.status(404).json({error:'Record not found'});return}response.json(result.rows[0])
})
router.delete('/operation-masters/:kind/:id',async(request:AuthedRequest,response)=>{
  const kind=operationKind.parse(request.params.kind)
  const result=await pool.query(`DELETE FROM hospital_operation_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3 RETURNING id`,[request.params.id,request.portalUser!.tenantId,kind])
  if(!result.rows[0]){response.status(404).json({error:'Record not found'});return}response.status(204).end()
})
const pharmacyKind=z.enum(['category','supplier','dosage','interval','duration','unit','company','group','medicine'])
const pharmacyBody=z.object({name:z.string().trim().min(1),data:z.record(z.string(),z.unknown()).optional().prefault({})})
async function validatePharmacyReferences(tenantId:string,body:z.infer<typeof pharmacyBody>){
  const refs=[['category_id','category'],['dosage_id','dosage'],['interval_id','interval'],['duration_id','duration'],['unit_id','unit'],['company_id','company'],['group_id','group']] as const
  for(const [key,kind] of refs){const id=body.data[key];if(!id)continue;const valid=await pool.query(`SELECT 1 FROM hospital_pharmacy_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3`,[id,tenantId,kind]);if(!valid.rowCount)throw new Error(`Invalid medicine ${kind}`)}
}
router.get('/pharmacy-masters/:kind',async(request:AuthedRequest,response)=>{
  const kind=pharmacyKind.parse(request.params.kind)
  const result=await pool.query(`SELECT * FROM hospital_pharmacy_masters WHERE tenant_id=$1 AND kind=$2 ORDER BY created_at DESC`,[request.portalUser!.tenantId,kind]);response.json(result.rows)
})
router.post('/pharmacy-masters/:kind',async(request:AuthedRequest,response)=>{
  const kind=pharmacyKind.parse(request.params.kind),body=pharmacyBody.parse(request.body),tenantId=request.portalUser!.tenantId;await validatePharmacyReferences(tenantId,body)
  const result=kind==='dosage'
    ?await pool.query(`INSERT INTO hospital_pharmacy_masters(tenant_id,kind,name,data) VALUES($1,$2,$3,$4)
      ON CONFLICT(tenant_id,kind,name) DO UPDATE SET data=excluded.data,updated_at=now() RETURNING *`,[tenantId,kind,body.name,body.data])
    :await pool.query(`INSERT INTO hospital_pharmacy_masters(tenant_id,kind,name,data) VALUES($1,$2,$3,$4) RETURNING *`,[tenantId,kind,body.name,body.data]);
  response.status(201).json(result.rows[0])
})
router.put('/pharmacy-masters/:kind/:id',async(request:AuthedRequest,response)=>{
  const kind=pharmacyKind.parse(request.params.kind),body=pharmacyBody.parse(request.body),tenantId=request.portalUser!.tenantId;await validatePharmacyReferences(tenantId,body)
  const result=await pool.query(`UPDATE hospital_pharmacy_masters SET name=$1,data=$2,updated_at=now() WHERE id=$3 AND tenant_id=$4 AND kind=$5 RETURNING *`,[body.name,body.data,request.params.id,tenantId,kind]);if(!result.rows[0]){response.status(404).json({error:'Record not found'});return}response.json(result.rows[0])
})
router.delete('/pharmacy-masters/:kind/:id',async(request:AuthedRequest,response)=>{
  const kind=pharmacyKind.parse(request.params.kind);const result=await pool.query(`DELETE FROM hospital_pharmacy_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3 RETURNING id`,[request.params.id,request.portalUser!.tenantId,kind]);if(!result.rows[0]){response.status(404).json({error:'Record not found'});return}response.status(204).end()
})
router.get('/diagnostic-branches',async(request:AuthedRequest,response)=>{
  const branches=await accessibleBranchIds(request.portalUser!);
  const result=await pool.query(`SELECT id,name,code FROM branches WHERE tenant_id=$1 AND is_active=true AND ($2::uuid[] IS NULL OR id=ANY($2)) ORDER BY name`,[request.portalUser!.tenantId,branches]);
  response.json(result.rows);
});
const diagnosticDomain=z.enum(['pathology','blood','symptoms']),diagnosticKind=z.enum(['test','category','unit','parameter','product','type','head','specimen','container','method','approver'])
const diagnosticBody=z.object({name:z.string().trim().min(1),data:z.record(z.string(),z.unknown()).optional().prefault({})})
async function validateDiagnosticReferences(tenantId:string,domain:string,body:z.infer<typeof diagnosticBody>){if(domain==='pathology'){const ids=validateLabPrices(body.data);if(ids.length){const branches=await pool.query('SELECT count(*)::int count FROM branches WHERE tenant_id=$1 AND id=ANY($2::uuid[])',[tenantId,ids]);if(branches.rows[0].count!==ids.length)throw new Error('Invalid laboratory price branch')}}for(const [key,kind] of [['unit_id','unit'],['type_id','type'],['category_id','category']] as const){const id=body.data[key];if(!id)continue;const valid=await pool.query(`SELECT 1 FROM hospital_diagnostic_masters WHERE id=$1 AND tenant_id=$2 AND domain=$3 AND kind=$4`,[id,tenantId,domain,kind]);if(!valid.rowCount)throw new Error(`Invalid ${kind} selection`)}for(const [key,kind] of [['billing_category_id','category'],['charge_id','charge']] as const){const id=body.data[key];if(!id)continue;const valid=await pool.query(`SELECT 1 FROM hospital_charge_masters WHERE id=$1 AND tenant_id=$2 AND kind=$3`,[id,tenantId,kind]);if(!valid.rowCount)throw new Error(`Invalid pathology ${kind} selection`)}const containerIds=Array.isArray(body.data.container_ids)?body.data.container_ids:[];if(containerIds.length){const ids=z.array(z.string().uuid()).parse(containerIds);const valid=await pool.query(`SELECT count(*)::int count FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain=$2 AND kind='container' AND id=ANY($3::uuid[])`,[tenantId,domain,ids]);if(valid.rows[0].count!==new Set(ids).size)throw new Error('Invalid Vaccu selection')}const parameterIds=Array.isArray(body.data.parameter_ids)?body.data.parameter_ids:[];if(parameterIds.length){const valid=await pool.query(`SELECT count(*)::int count FROM hospital_diagnostic_masters WHERE tenant_id=$1 AND domain=$2 AND kind='parameter' AND id=ANY($3::uuid[])`,[tenantId,domain,parameterIds]);if(valid.rows[0].count!==new Set(parameterIds).size)throw new Error('Invalid pathology parameter selection')}}
router.get('/diagnostic-masters/:domain/:kind',async(request:AuthedRequest,response)=>{const domain=diagnosticDomain.parse(request.params.domain),kind=diagnosticKind.parse(request.params.kind);const result=await pool.query(`SELECT m.*,b.name created_branch_name FROM hospital_diagnostic_masters m LEFT JOIN branches b ON b.tenant_id=m.tenant_id AND b.id::text=m.data->>'created_branch_id' WHERE m.tenant_id=$1 AND m.domain=$2 AND m.kind=$3 ORDER BY m.created_at DESC`,[request.portalUser!.tenantId,domain,kind]);response.json(result.rows)})
router.post('/diagnostic-masters/:domain/:kind',async(request:AuthedRequest,response)=>{const domain=diagnosticDomain.parse(request.params.domain),kind=diagnosticKind.parse(request.params.kind),body=diagnosticBody.parse(request.body),tenantId=request.portalUser!.tenantId;delete body.data.created_branch_id;if(domain==='pathology'&&kind==='test')body.data.test_type=diagnosticTestType.parse(body.data.test_type);if(domain==='pathology'&&kind==='test')body.data.created_branch_id=request.portalUser!.branchId||null;await validateDiagnosticReferences(tenantId,domain,body);const result=await pool.query(`INSERT INTO hospital_diagnostic_masters(tenant_id,domain,kind,name,data) VALUES($1,$2,$3,$4,$5) RETURNING *`,[tenantId,domain,kind,body.name,body.data]);response.status(201).json(result.rows[0])})
router.put('/diagnostic-masters/:domain/:kind/:id',async(request:AuthedRequest,response)=>{const domain=diagnosticDomain.parse(request.params.domain),kind=diagnosticKind.parse(request.params.kind),body=diagnosticBody.parse(request.body),tenantId=request.portalUser!.tenantId;delete body.data.created_branch_id;if(domain==='pathology'&&kind==='test')body.data.test_type=diagnosticTestType.parse(body.data.test_type);await validateDiagnosticReferences(tenantId,domain,body);const result=await pool.query(`UPDATE hospital_diagnostic_masters SET name=$1,data=$2::jsonb || CASE WHEN data ? 'created_branch_id' THEN jsonb_build_object('created_branch_id',data->'created_branch_id') ELSE '{}'::jsonb END,updated_at=now() WHERE id=$3 AND tenant_id=$4 AND domain=$5 AND kind=$6 RETURNING *`,[body.name,body.data,request.params.id,tenantId,domain,kind]);if(!result.rows[0]){response.status(404).json({error:'Record not found'});return}response.json(result.rows[0])})
router.delete('/diagnostic-masters/:domain/:kind/:id',async(request:AuthedRequest,response)=>{const domain=diagnosticDomain.parse(request.params.domain),kind=diagnosticKind.parse(request.params.kind);const result=await pool.query(`DELETE FROM hospital_diagnostic_masters WHERE id=$1 AND tenant_id=$2 AND domain=$3 AND kind=$4 RETURNING id`,[request.params.id,request.portalUser!.tenantId,domain,kind]);if(!result.rows[0]){response.status(404).json({error:'Record not found'});return}response.status(204).end()})

router.get('/branches/:id/overview', async (request: AuthedRequest, response) => {
  const branchId=z.string().uuid().parse(request.params.id),tenantId=request.portalUser!.tenantId
  const branch=await pool.query('SELECT * FROM branches WHERE id=$1 AND tenant_id=$2',[branchId,tenantId])
  if(!branch.rowCount){response.status(404).json({error:'Branch not found'});return}
  const counts=await pool.query(branchOverviewCountsSql,[tenantId,branchId])
  response.json({branch:branch.rows[0],counts:counts.rows[0]})
})

router.get('/:resource', async (request: AuthedRequest, response) => {
  const resource = resourceName.parse(request.params.resource) as Resource
  const config = resources[resource]
  const activeFilter=['branches','departments'].includes(resource) && request.query.include_inactive!=='true' ? ' AND is_active=true' : ''
  const result = await pool.query(`SELECT * FROM ${config.table} WHERE tenant_id=$1${activeFilter} ORDER BY created_at DESC`, [request.portalUser!.tenantId])
  response.json(result.rows)
})

router.post('/:resource', async (request: AuthedRequest, response) => {
  const resource = resourceName.parse(request.params.resource) as Resource
  const config = resources[resource]
  const body = z.record(z.string(), z.unknown()).parse(request.body)
  validateResourceFields(resource,body)
  await validateTenantReferences(body, request.portalUser!.tenantId)
  if(resource==='beds')await validateBedLocation(body,request.portalUser!.tenantId)
  if(resource==='wards')await validateWardLocation(body,request.portalUser!.tenantId)
  if(resource==='rooms')await validateRoomLocation(body,request.portalUser!.tenantId)
  const columns = config.columns.filter(key => key in body)
  if (!columns.length) { response.status(400).json({ error:'No fields supplied' }); return }
  const values = columns.map(key => resourceValue(key,body[key]))
  const placeholders = columns.map((_, index) => `$${index + 2}`).join(',')
  const result = await pool.query(
    `INSERT INTO ${config.table} (tenant_id,${columns.join(',')}) VALUES ($1,${placeholders}) RETURNING *`,
    [request.portalUser!.tenantId, ...values],
  )
  response.status(201).json(result.rows[0])
})

router.put('/:resource/:id', async (request: AuthedRequest, response) => {
  const resource = resourceName.parse(request.params.resource) as Resource
  const config = resources[resource]
  const body = z.record(z.string(), z.unknown()).parse(request.body)
  validateResourceFields(resource,body)
  await validateTenantReferences(body, request.portalUser!.tenantId)
  if(resource==='beds')await validateBedLocation(body,request.portalUser!.tenantId)
  if(resource==='wards')await validateWardLocation(body,request.portalUser!.tenantId)
  if(resource==='rooms')await validateRoomLocation(body,request.portalUser!.tenantId)
  const columns = config.columns.filter(key => key in body)
  if (!columns.length) { response.status(400).json({ error:'No fields supplied' }); return }
  const set = columns.map((key,index) => `${key}=$${index + 3}`).join(',')
  const values = columns.map(key => resourceValue(key,body[key]))
  const result = await pool.query(
    `UPDATE ${config.table} SET ${set},updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING *`,
    [request.params.id, request.portalUser!.tenantId, ...values],
  )
  if (!result.rows[0]) { response.status(404).json({ error:'Record not found' }); return }
  response.json(result.rows[0])
})

router.delete('/:resource/:id', async (request: AuthedRequest, response) => {
  const resource = resourceName.parse(request.params.resource) as Resource
  const config = resources[resource]
  if(resource==='branches'){
    const result=await pool.query(`UPDATE branches SET is_active=false,updated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id`,[request.params.id,request.portalUser!.tenantId])
    if(!result.rowCount){response.status(404).json({error:'Branch not found'});return}
    response.status(204).end();return
  }
  if(resource==='beds'){
    const bed=await pool.query(`SELECT status FROM beds WHERE id=$1 AND tenant_id=$2`,[request.params.id,request.portalUser!.tenantId])
    if(!bed.rows[0]){response.status(404).json({error:'Bed not found'});return}
    const active=await pool.query(`SELECT 1 FROM ipd_admissions WHERE tenant_id=$1 AND bed_id=$2 AND lower(trim(status)) NOT IN ('discharged','cancelled') LIMIT 1`,[request.portalUser!.tenantId,request.params.id])
    if(String(bed.rows[0].status).toLowerCase()==='occupied'||active.rowCount){
      response.status(409).json({error:'Occupied beds cannot be deleted. Transfer or discharge the patient first.'});return
    }
  }
  try{
    const result = await pool.query(`DELETE FROM ${config.table} WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [request.params.id, request.portalUser!.tenantId])
    if (!result.rows[0]) { response.status(404).json({ error:'Record not found' }); return }
    response.status(204).end()
  }catch(error){
    if((error as {code?:string}).code==='23503'){
      response.status(409).json({error:'This record is in use and cannot be deleted. Deactivate it or remove its active references first.'});return
    }
    throw error
  }
})

router.get('/staff/list', async (request: AuthedRequest, response) => {
  const values:unknown[]=[request.portalUser!.tenantId]
  let filter=''
  if(request.query.type){values.push(request.query.type);filter=` AND (s.staff_type=$2 OR lower(s.account->>'role')=lower($2) OR EXISTS(SELECT 1 FROM rbac_user_roles ur JOIN rbac_roles r ON r.id=ur.role_id AND r.tenant_id=s.tenant_id WHERE ur.tenant_id=s.tenant_id AND ur.user_id=s.user_id AND lower(r.name)=lower($2)))`}
  const result=await pool.query(
    `SELECT s.*,coalesce(ba.branch_ids,ARRAY[s.branch_id]::uuid[]) branch_ids,
       coalesce(ba.branch_names,ARRAY[b.name]::text[]) branch_names,b.name branch_name,
       d.name department_name,u.username,u.email login_email,u.is_active account_active,u.force_password_change account_force_password_change
     FROM staff_members s LEFT JOIN branches b ON b.id=s.branch_id AND b.tenant_id=s.tenant_id
     LEFT JOIN LATERAL (SELECT array_agg(uba.branch_id ORDER BY br.name) branch_ids,array_agg(br.name ORDER BY br.name) branch_names
       FROM user_branch_access uba JOIN branches br ON br.id=uba.branch_id WHERE uba.tenant_id=s.tenant_id AND uba.user_id=s.user_id) ba ON true
     LEFT JOIN departments d ON d.id=s.department_id AND d.tenant_id=s.tenant_id
     LEFT JOIN users u ON u.id=s.user_id WHERE s.tenant_id=$1${filter} ORDER BY s.created_at DESC`,values)
  response.json(result.rows)
})

router.get('/staff/roles', async (request: AuthedRequest, response) => {
  const result=await pool.query(
    `SELECT id,name,code::text,status,is_system FROM rbac_roles WHERE tenant_id=$1 AND status='Active' ORDER BY is_system DESC,name`,
    [request.portalUser!.tenantId],
  )
  response.json(result.rows.map(role=>({...role,name:roleLabel(role.name)})))
})

router.get('/staff/:id/appointment-schedule', async (request: AuthedRequest, response) => {
  const staff = await pool.query(`SELECT user_id,professional FROM staff_members WHERE id=$1 AND tenant_id=$2 AND staff_type='Doctor'`, [request.params.id, request.portalUser!.tenantId])
  if (!staff.rows[0]) { response.status(404).json({ error: 'Doctor not found' }); return }
  const schedule = Array.isArray(staff.rows[0].professional?.appointment_schedule) ? staff.rows[0].professional.appointment_schedule : []
  const counts = await pool.query(`SELECT appointment_date::text date,count(*)::int booked FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND lower(status) NOT IN ('cancelled','no show') GROUP BY appointment_date`, [request.portalUser!.tenantId, staff.rows[0].user_id])
  const normalizeDate=(value:unknown)=>{const raw=String(value??'');if(/^\d{2}-\d{2}-\d{4}$/.test(raw)){const [day,month,year]=raw.split('-');return `${year}-${month}-${day}`}return raw.slice(0,10)}
  const booked = Object.fromEntries(counts.rows.map(row => [normalizeDate(row.date), row.booked]))
  response.json({ default_schedule:staff.rows[0].professional?.appointment_default_schedule??null,unavailable_dates:staff.rows[0].professional?.appointment_unavailable_dates??[],schedule: schedule.map((item: Record<string, unknown>) => ({ ...item, appointment_date: normalizeDate(item.appointment_date), booked: booked[normalizeDate(item.appointment_date)] ?? 0 })) })
})

router.put('/staff/:id/appointment-schedule', async (request: AuthedRequest, response) => {
  const body = z.object({ appointment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), from_time: z.string().min(1), to_time: z.string().min(1), max_slots: z.coerce.number().int().min(1).max(500) }).parse(request.body)
  if (body.from_time >= body.to_time) { response.status(400).json({ error: 'End time must be after start time' }); return }
  const staff = await pool.query(`SELECT professional FROM staff_members WHERE id=$1 AND tenant_id=$2 AND staff_type='Doctor'`, [request.params.id, request.portalUser!.tenantId])
  if (!staff.rows[0]) { response.status(404).json({ error: 'Doctor not found' }); return }
  const professional = staff.rows[0].professional ?? {}, current = Array.isArray(professional.appointment_schedule) ? professional.appointment_schedule : []
  const normalizeDate=(value:unknown)=>{const raw=String(value??'');if(/^\d{2}-\d{2}-\d{4}$/.test(raw)){const [day,month,year]=raw.split('-');return `${year}-${month}-${day}`}return raw.slice(0,10)}
  const schedule = [...current.filter((item: Record<string, unknown>) => normalizeDate(item.appointment_date) !== body.appointment_date), {...body,...(professional.appointment_default_schedule?.slot_mode==='capacity'?{slot_mode:'capacity'}:{})}].sort((a, b) => String(a.appointment_date).localeCompare(String(b.appointment_date)))
  await pool.query(`UPDATE staff_members SET professional=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3`, [{ ...professional, appointment_schedule: schedule,appointment_unavailable_dates:(professional.appointment_unavailable_dates??[]).filter((date:string)=>normalizeDate(date)!==body.appointment_date) }, request.params.id, request.portalUser!.tenantId])
  response.json({ schedule })
})

router.delete('/staff/:id/appointment-schedule/:date', async (request: AuthedRequest, response) => {
  const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(request.params.date)
  const staff=await pool.query(`SELECT user_id,professional FROM staff_members WHERE id=$1 AND tenant_id=$2 AND staff_type='Doctor'`,[request.params.id,request.portalUser!.tenantId])
  if(!staff.rows[0]){response.status(404).json({error:'Doctor not found'});return}
  const booked=await pool.query(`SELECT count(*)::int count FROM clinical_appointments WHERE tenant_id=$1 AND doctor_id=$2 AND appointment_date=$3 AND lower(status) NOT IN ('cancelled','no show')`,[request.portalUser!.tenantId,staff.rows[0].user_id,date])
  if(booked.rows[0].count>0){response.status(409).json({error:'This slot has booked patients and cannot be removed.'});return}
  const normalizeDate=(value:unknown)=>{const raw=String(value??'');if(/^\d{2}-\d{2}-\d{4}$/.test(raw)){const [day,month,year]=raw.split('-');return `${year}-${month}-${day}`}return raw.slice(0,10)}
  const professional=staff.rows[0].professional??{},current=Array.isArray(professional.appointment_schedule)?professional.appointment_schedule:[]
  await pool.query(`UPDATE staff_members SET professional=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3`,[{...professional,appointment_schedule:current.filter((item:Record<string,unknown>)=>normalizeDate(item.appointment_date)!==date),...(professional.appointment_default_schedule?{appointment_unavailable_dates:[...new Set([...(professional.appointment_unavailable_dates??[]),date])]}:{})},request.params.id,request.portalUser!.tenantId])
  response.status(204).end()
})

router.post('/staff/save', async (request: AuthedRequest, response) => {
  const body=staffSaveBody.parse(request.body)
  body.branch_id=body.branch_ids[0]
  body.employment.status=body.status
  await validateTenantReferences(body as unknown as Record<string,unknown>,request.portalUser!.tenantId)
  const validBranches=await pool.query(`SELECT count(*)::int count FROM branches WHERE tenant_id=$1 AND id=ANY($2::uuid[])`,[request.portalUser!.tenantId,body.branch_ids])
  if(validBranches.rows[0].count!==body.branch_ids.length){response.status(400).json({error:'Invalid branch selection'});return}
  if(body.staff_type==='Nurse'&&body.professional.ward_assignment){
    const assignedWard=await pool.query(`SELECT branch_id FROM wards WHERE id=$1 AND tenant_id=$2`,[body.professional.ward_assignment,request.portalUser!.tenantId])
    if(!assignedWard.rows[0]){response.status(400).json({error:'Please select a valid ward from Ward Master.'});return}
    if(!body.branch_ids.includes(assignedWard.rows[0].branch_id)){response.status(400).json({error:'The selected ward must belong to one of the nurse assigned branches.'});return}
  }
  const client=await pool.connect()
  try{
    await client.query('BEGIN')
    const account=body.account as Record<string,unknown>
    let userId:string|null=null
    let rbacRoleId:string|null=null
    const loginEmail=String(account.login_email??'').trim()
    const username=String(account.username??'').trim()
    if(loginEmail&&username){
      const selectedRole=String(account.role??body.staff_type).trim()
      const rbacRole=await client.query(
        `SELECT id,upper(code::text) code FROM rbac_roles WHERE tenant_id=$1 AND status='Active' AND (lower(name)=lower($2) OR lower(code::text)=lower($2)) LIMIT 1`,
        [request.portalUser!.tenantId,selectedRole],
      )
      if(!rbacRole.rows[0]){await client.query('ROLLBACK');response.status(400).json({error:'Please select an active role from Access Control.'});return}
      rbacRoleId=rbacRole.rows[0].id
      const roleMap:Record<string,string>={'BRANCH_ADMIN':'hospital_admin',DOCTOR:'doctor','HR_MANAGER':'hr','INVENTORY_MANAGER':'receptionist','LAB_MANAGER':'laboratory',LAB_TECHNICIAN:'laboratory',PATHOLOGIST:'laboratory',NURSE:'nurse','PHARMACY_MANAGER':'pharmacist',RADIOLOGIST:'radiology',RECEPTIONIST:'receptionist',ACCOUNTANT:'accountant'}
      const portalRole=roleMap[rbacRole.rows[0].code]??'receptionist'
      const password=String(account.password??'')
      if(body.id){
        const existing=await client.query(`SELECT user_id FROM staff_members WHERE id=$1 AND tenant_id=$2`,[body.id,request.portalUser!.tenantId])
        userId=existing.rows[0]?.user_id??null
      }
      if(userId){
        await client.query(`UPDATE users SET username=$1,email=$2,phone=$3,role=$4::user_role,branch_id=$5,
          is_active=$6,force_password_change=$7,two_factor_enabled=$8,account_expires_at=$9,
          password_hash=CASE WHEN $10<>'' THEN crypt($10,gen_salt('bf',12)) ELSE password_hash END,
          department_id=$11,first_name=$12,last_name=$13,updated_at=now()
          WHERE id=$14 AND tenant_id=$15`,[username,loginEmail,account.mobile||null,portalRole,body.branch_id||null,
          staffAccountActive(body.status,body.account.account_status),Boolean(account.force_password_change),Boolean(account.two_factor),account.account_expiry||null,password,
          body.department_id||null,body.first_name,body.last_name,userId,request.portalUser!.tenantId])
      }else{
        const created=await client.query(`INSERT INTO users(tenant_id,branch_id,department_id,email,phone,username,password_hash,
          first_name,last_name,role,is_active,force_password_change,two_factor_enabled,account_expires_at)
          VALUES($1,$2,$3,$4,$5,$6,crypt($7,gen_salt('bf',12)),$8,$9,$10::user_role,$11,$12,$13,$14) RETURNING id`,
          [request.portalUser!.tenantId,body.branch_id||null,body.department_id||null,loginEmail,account.mobile||null,username,
          password||crypto.randomUUID(),body.first_name,body.last_name,portalRole,
          staffAccountActive(body.status,body.account.account_status),Boolean(account.force_password_change),Boolean(account.two_factor),account.account_expiry||null])
        userId=created.rows[0].id
      }
    }
    if(userId&&rbacRoleId){
      await client.query(`DELETE FROM rbac_user_roles WHERE tenant_id=$1 AND user_id=$2`,[request.portalUser!.tenantId,userId])
      await client.query(`INSERT INTO rbac_user_roles(tenant_id,user_id,role_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[request.portalUser!.tenantId,userId,rbacRoleId])
      await replaceUserBranchAccess(client,request.portalUser!.tenantId,userId,body.branch_ids)
    }
    let result
    if(body.id){
      result=await client.query(`UPDATE staff_members SET user_id=$1,first_name=$2,middle_name=$3,last_name=$4,profile_photo=$5,
        staff_type=$6,branch_id=$7,department_id=$8,designation=$9,employment_type=$10,joining_date=$11,status=$12,
        personal=$13,employment=$14,account=$15,professional=$16,updated_at=now() WHERE id=$17 AND tenant_id=$18 RETURNING *`,
        [userId,body.first_name,body.middle_name,body.last_name,body.profile_photo,body.staff_type,body.branch_id||null,
        body.department_id||null,body.designation,body.employment_type,body.joining_date||null,body.status,
        body.personal,body.employment,body.account,body.professional,body.id,request.portalUser!.tenantId])
    }else{
      const count=await client.query(`SELECT coalesce(max(nullif(regexp_replace(employee_id,'\\D','','g'),'')::bigint),0)+1 next FROM staff_members WHERE tenant_id=$1`,[request.portalUser!.tenantId])
      const prefix=await configuredPrefix(request.portalUser!.tenantId,'employee_prefix','EMP')
      const employeeId=`${prefix}-${String(count.rows[0].next).padStart(5,'0')}`
      result=await client.query(`INSERT INTO staff_members(tenant_id,user_id,employee_id,first_name,middle_name,last_name,
        profile_photo,staff_type,branch_id,department_id,designation,employment_type,joining_date,status,personal,employment,account,professional)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [request.portalUser!.tenantId,userId,employeeId,body.first_name,body.middle_name,body.last_name,body.profile_photo,
        body.staff_type,body.branch_id||null,body.department_id||null,body.designation,body.employment_type,body.joining_date||null,
        body.status,body.personal,body.employment,body.account,body.professional])
    }
    await client.query('COMMIT');response.json(result.rows[0])
  }catch(error){
    await client.query('ROLLBACK')
    const databaseError=error as {code?:string;constraint?:string;message?:string}
    if(databaseError.code==='23505'){
      const field=databaseError.constraint?.includes('username')?'username':databaseError.constraint?.includes('email')?'email':'staff account'
      response.status(409).json({error:`This ${field} is already in use. Please enter a different ${field}.`});return
    }
    if(databaseError.code==='22P02'){
      response.status(400).json({error:'The selected staff role or account value is invalid.'});return
    }
    throw error
  }finally{client.release()}
})

router.delete('/staff/record/:id', async (request:AuthedRequest,response)=>{
  const result=await pool.query(`DELETE FROM staff_members WHERE id=$1 AND tenant_id=$2 RETURNING user_id`,
    [request.params.id,request.portalUser!.tenantId])
  if(!result.rows[0]){response.status(404).json({error:'Staff member not found'});return}
  if(result.rows[0].user_id)await pool.query(`UPDATE users SET is_active=false WHERE id=$1 AND tenant_id=$2`,[result.rows[0].user_id,request.portalUser!.tenantId])
  response.status(204).end()
})

export default router
