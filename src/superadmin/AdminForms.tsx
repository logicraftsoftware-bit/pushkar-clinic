import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft, Building2, Check, CreditCard, Image, LoaderCircle, Save,
  ShieldCheck, Sparkles, UserRound, Boxes,
} from 'lucide-react'
import { adminApi } from './api'

type Module = { id: string; name: string; description: string }
type Plan = {
  id: string; name: string; code: string; description: string
  monthly_price: string; yearly_price: string; trial_days: number
  max_branches: number; max_users: number; max_doctors: number
  storage_limit_gb: number; ai_usage_limit: number; status: 'active' | 'inactive'
  module_ids?: string[]
}
type Hospital = {
  admin_id?: string
  name: string; code: string; logo_url?: string; hospital_type: string
  registration_number: string; email: string; phone: string; emergency_phone: string
  address_line: string; city: string; state: string; pin_code: string; country: string
  gstin?: string; branch_name: string; plan_id: string; subscription_start_date: string
  billing_cycle: 'monthly' | 'yearly'; status: 'active' | 'trial' | 'suspended' | 'inactive'
  trial_days: number
  admin_name: string; admin_email: string; admin_phone: string
}

function FormHeader({ title, text, onBack }: { title: string; text: string; onBack: () => void }) {
  return <div className="entity-form-head"><button onClick={onBack}><ArrowLeft /></button><div><small>Platform administration</small><h1>{title}</h1><p>{text}</p></div></div>
}
function Section({ icon: Icon, title, text, children }: { icon: typeof Building2; title: string; text: string; children: React.ReactNode }) {
  return <section className="entity-section"><div className="entity-section-title"><span><Icon /></span><div><h2>{title}</h2><p>{text}</p></div></div><div className="entity-fields">{children}</div></section>
}
function Field({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: React.ReactNode }) {
  return <label className={wide ? 'wide' : ''}><span>{label}{required && <em>*</em>}</span>{children}</label>
}

export function PlanForm({ editId, onBack, onSaved }: { editId?: string; onBack: () => void; onSaved: () => void }) {
  const [modules, setModules] = useState<Module[]>([]), [plan, setPlan] = useState<Plan | null>(null)
  const [selected, setSelected] = useState<string[]>([]), [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    adminApi<Module[]>('/modules').then(setModules)
    if (editId) adminApi<Plan>(`/plans/${editId}`).then(value => { setPlan(value); setSelected(value.module_ids ?? []) })
  }, [editId])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    const fd = new FormData(event.currentTarget)
    const payload = {
      name: fd.get('name'), code: fd.get('code'), description: fd.get('description'),
      monthlyPrice: Number(fd.get('monthlyPrice')), yearlyPrice: Number(fd.get('yearlyPrice')),
      trialDays: Number(fd.get('trialDays')), maxBranches: Number(fd.get('maxBranches')),
      maxUsers: Number(fd.get('maxUsers')), maxDoctors: Number(fd.get('maxDoctors')),
      storageLimitGb: Number(fd.get('storageLimitGb')), aiUsageLimit: Number(fd.get('aiUsageLimit')),
      status: fd.get('status'), moduleIds: selected,
    }
    try {
      await adminApi(editId ? `/plans/${editId}` : '/plans', { method: editId ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save plan') } finally { setSaving(false) }
  }
  if (editId && !plan) return <div className="sa-loading"><LoaderCircle className="spin" />Loading subscription plan…</div>
  return <form className="entity-form" onSubmit={submit}><FormHeader title={editId ? 'Edit subscription plan' : 'Create subscription plan'} text="Define commercial limits, included capabilities and availability." onBack={onBack} />
    <Section icon={CreditCard} title="Plan information" text="Name, pricing and customer-facing details.">
      <Field label="Plan name" required><input name="name" required defaultValue={plan?.name} placeholder="Professional" /></Field>
      <Field label="Plan code" required><input name="code" required defaultValue={plan?.code} placeholder="professional" /></Field>
      <Field label="Description" wide><textarea name="description" rows={3} defaultValue={plan?.description} placeholder="Describe who this plan is designed for…" /></Field>
      <Field label="Monthly price (₹)" required><input name="monthlyPrice" required type="number" min="0" step=".01" defaultValue={plan?.monthly_price ?? 0} /></Field>
      <Field label="Yearly price (₹)" required><input name="yearlyPrice" required type="number" min="0" step=".01" defaultValue={plan?.yearly_price ?? 0} /></Field>
      <Field label="Trial days" required><input name="trialDays" required type="number" min="0" defaultValue={plan?.trial_days ?? 14} /></Field>
      <Field label="Plan status" required><select name="status" defaultValue={plan?.status ?? 'active'}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
    </Section>
    <Section icon={ShieldCheck} title="Usage limits" text="Set the maximum resources available to each subscribing clinic.">
      <Field label="Maximum branches" required><input name="maxBranches" required type="number" min="1" defaultValue={plan?.max_branches ?? 1} /></Field>
      <Field label="Maximum users" required><input name="maxUsers" required type="number" min="1" defaultValue={plan?.max_users ?? 25} /></Field>
      <Field label="Maximum doctors" required><input name="maxDoctors" required type="number" min="1" defaultValue={plan?.max_doctors ?? 10} /></Field>
      <Field label="Storage limit (GB)" required><input name="storageLimitGb" required type="number" min="1" defaultValue={plan?.storage_limit_gb ?? 10} /></Field>
      <Field label="AI usage limit" required><input name="aiUsageLimit" required type="number" min="0" defaultValue={plan?.ai_usage_limit ?? 0} /></Field>
    </Section>
    <Section icon={Boxes} title="Enabled modules" text="Choose the product modules included with this plan.">
      <div className="entity-module-grid">{modules.map(module => <button type="button" className={selected.includes(module.id) ? 'selected' : ''} onClick={() => setSelected(value => value.includes(module.id) ? value.filter(id => id !== module.id) : [...value, module.id])} key={module.id}><span><Boxes /></span><div><strong>{module.name}</strong><small>{module.description}</small></div><i>{selected.includes(module.id) && <Check />}</i></button>)}</div>
    </Section>
    <div className="entity-actionbar">{error && <span className="entity-error">{error}</span>}<button type="button" className="sa-secondary" onClick={onBack}>Cancel</button><button className="sa-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}{editId ? 'Save changes' : 'Create plan'}</button></div>
  </form>
}

export function HospitalForm({ editId, onBack, onSaved }: { editId?: string; onBack: () => void; onSaved: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]), [hospital, setHospital] = useState<Hospital | null>(null)
  const [logo, setLogo] = useState(''), [saving, setSaving] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    adminApi<Plan[]>('/plans').then(value => setPlans(value.filter(p => p.status === 'active')))
    if (editId) adminApi<Hospital>(`/hospitals/${editId}`).then(value => { setHospital(value); setLogo(value.logo_url ?? '') })
  }, [editId])
  async function chooseLogo(file?: File) {
    if (!file) return
    if (file.size > 500_000) { setError('Logo must be smaller than 500 KB.'); return }
    const reader = new FileReader()
    reader.onload = () => setLogo(String(reader.result)); reader.readAsDataURL(file)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('')
    const fd = new FormData(event.currentTarget)
    const value = (name: string) => String(fd.get(name) ?? '')
    const payload = {
      name:value('name'),code:value('code'),logoUrl:logo || null,hospitalType:value('hospitalType'),
      registrationNumber:value('registrationNumber'),email:value('email'),phone:value('phone'),
      emergencyPhone:value('emergencyPhone'),address:value('address'),city:value('city'),state:value('state'),
      pinCode:value('pinCode'),country:value('country'),gstin:value('gstin'),branchName:value('branchName'),
      planId:value('planId'),subscriptionStartDate:value('subscriptionStartDate'),billingCycle:value('billingCycle'),
      trialDays:Number(fd.get('trialDays')),status:value('status'),adminName:value('adminName'),
      adminEmail:value('adminEmail'),adminPhone:value('adminPhone'),password:value('password') || undefined,
    }
    try {
      await adminApi(editId ? `/hospitals/${editId}` : '/hospitals', { method: editId ? 'PUT' : 'POST', body: JSON.stringify(payload) })
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save clinic') } finally { setSaving(false) }
  }
  if (editId && !hospital) return <div className="sa-loading"><LoaderCircle className="spin" />Loading clinic…</div>
  const date = hospital?.subscription_start_date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
  return <form className="entity-form" onSubmit={submit}><FormHeader title={editId ? 'Edit clinic' : 'Create clinic'} text="Provision the tenant profile, subscription, main branch and administrator." onBack={onBack} />
    <Section icon={Building2} title="Clinic identity" text="Core registration and contact information.">
      <div className="logo-field wide"><div className="logo-preview">{logo ? <img src={logo} alt="Clinic logo preview" /> : <Image />}</div><label><strong>Clinic logo</strong><small>PNG, JPG or WebP. Maximum 500 KB.</small><input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => chooseLogo(e.target.files?.[0])} /></label></div>
      <Field label="Clinic name" required><input name="name" required defaultValue={hospital?.name} /></Field>
      <Field label="Clinic code / Tenant code" required><input name="code" required defaultValue={hospital?.code} /></Field>
      <Field label="Clinic type" required><select name="hospitalType" defaultValue={hospital?.hospital_type ?? ''} required><option value="" disabled>Select type</option><option>Multi-speciality</option><option value="General Hospital">General Clinic</option><option>Clinic</option><option>Diagnostic Centre</option><option>Nursing Home</option><option value="Speciality Hospital">Speciality Clinic</option></select></Field>
      <Field label="Registration number" required><input name="registrationNumber" required defaultValue={hospital?.registration_number} /></Field>
      <Field label="Clinic email" required><input name="email" type="email" required defaultValue={hospital?.email} /></Field>
      <Field label="Phone number" required><input name="phone" type="tel" required defaultValue={hospital?.phone} /></Field>
      <Field label="Emergency phone" required><input name="emergencyPhone" type="tel" required defaultValue={hospital?.emergency_phone} /></Field>
      <Field label="GSTIN"><input name="gstin" defaultValue={hospital?.gstin} /></Field>
    </Section>
    <Section icon={Building2} title="Address & branch" text="Primary registered location and first operating branch.">
      <Field label="Address" wide required><textarea name="address" rows={3} required defaultValue={hospital?.address_line} /></Field>
      <Field label="City" required><input name="city" required defaultValue={hospital?.city} /></Field>
      <Field label="State" required><input name="state" required defaultValue={hospital?.state} /></Field>
      <Field label="PIN code" required><input name="pinCode" required defaultValue={hospital?.pin_code} /></Field>
      <Field label="Country" required><input name="country" required defaultValue={hospital?.country ?? 'India'} /></Field>
      <Field label="Main branch name" wide required><input name="branchName" required defaultValue={hospital?.branch_name} /></Field>
    </Section>
    <Section icon={CreditCard} title="Subscription" text="Assign commercial terms and initial tenant status.">
      <Field label="Subscription plan" required><select name="planId" required defaultValue={hospital?.plan_id ?? ''}><option value="" disabled>Select a plan</option>{plans.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</select></Field>
      <Field label="Subscription start date" required><input name="subscriptionStartDate" type="date" required defaultValue={date} /></Field>
      <Field label="Billing cycle" required><select name="billingCycle" defaultValue={hospital?.billing_cycle ?? 'monthly'}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></Field>
      <Field label="Trial days" required><input name="trialDays" type="number" min="0" required defaultValue={hospital?.trial_days ?? 14} /></Field>
      <Field label="Clinic status" required><select name="status" defaultValue={hospital?.status ?? 'trial'}><option value="active">Active</option><option value="trial">Trial</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option></select></Field>
    </Section>
    <Section icon={UserRound} title="Clinic administrator" text="Create the first administrator responsible for this tenant.">
      <Field label="Admin name" required><input name="adminName" required defaultValue={hospital?.admin_name} /></Field>
      <Field label="Admin email" required><input name="adminEmail" type="email" required defaultValue={hospital?.admin_email} /></Field>
      <Field label="Admin phone" required><input name="adminPhone" type="tel" required defaultValue={hospital?.admin_phone} /></Field>
      <Field label={editId && hospital?.admin_id ? 'New password (optional)' : 'Password'} required={!editId || !hospital?.admin_id}><input name="password" type="password" required={!editId || !hospital?.admin_id} minLength={8} autoComplete="new-password" /></Field>
    </Section>
    <div className="entity-actionbar">{error && <span className="entity-error">{error}</span>}<button type="button" className="sa-secondary" onClick={onBack}>Cancel</button><button className="sa-primary" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}{editId ? 'Save hospital' : 'Create clinic'}</button></div>
  </form>
}
