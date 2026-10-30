import { useCallback, useEffect, useState } from 'react'
import { Boxes, Edit3, Plus, Trash2 } from 'lucide-react'
import { adminApi } from './api'

type Plan = {
  id: string; name: string; code: string; description: string
  monthly_price: string; yearly_price: string; trial_days: number
  max_branches: number; max_users: number; max_doctors: number
  storage_limit_gb: number; ai_usage_limit: number; status: string
  modules: { id: string; name: string }[]; hospital_count: number
}

export default function PlanList({ onCreate, onEdit }: { onCreate: () => void; onEdit: (id: string) => void }) {
  const [plans, setPlans] = useState<Plan[]>([]), [error, setError] = useState('')
  const load = useCallback(() => adminApi<Plan[]>('/plans').then(setPlans), [])
  useEffect(() => { load() }, [load])
  async function remove(plan: Plan) {
    if (!confirm(`Delete subscription plan "${plan.name}"?`)) return
    setError('')
    try { await adminApi(`/plans/${plan.id}`, { method: 'DELETE' }); load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete plan') }
  }
  return <><div className="sa-pagehead"><div><small>Platform / Subscription plans</small><h1>Subscription plans</h1><p>Create product tiers, usage limits, pricing and included modules.</p></div><button className="sa-primary" onClick={onCreate}><Plus /> Create plan</button></div>
    {error && <div className="list-alert">{error}</div>}
    <div className="plan-list-grid">{plans.map(plan => <article className="sa-card plan-list-card" key={plan.id}>
      <div className="plan-list-top"><div><span className={`sa-badge ${plan.status}`}>{plan.status}</span><h2>{plan.name}</h2><code>{plan.code}</code></div><div className="plan-actions"><button onClick={() => onEdit(plan.id)} title="Edit plan"><Edit3 /></button><button className="danger" onClick={() => remove(plan)} title="Delete plan"><Trash2 /></button></div></div>
      <p>{plan.description || 'No description provided.'}</p>
      <div className="plan-prices"><div><span>Monthly</span><strong>₹{Number(plan.monthly_price).toLocaleString('en-IN')}</strong></div><div><span>Yearly</span><strong>₹{Number(plan.yearly_price).toLocaleString('en-IN')}</strong></div></div>
      <div className="plan-limits"><span><strong>{plan.max_branches}</strong> Branches</span><span><strong>{plan.max_users}</strong> Users</span><span><strong>{plan.max_doctors}</strong> Doctors</span><span><strong>{plan.storage_limit_gb} GB</strong> Storage</span><span><strong>{plan.ai_usage_limit}</strong> AI usage</span><span><strong>{plan.trial_days} days</strong> Trial</span></div>
      <div className="plan-modules"><div><Boxes /><strong>Enabled modules</strong><span>{plan.modules.length}</span></div><p>{plan.modules.map(m => m.name).join(' · ') || 'No modules enabled'}</p></div>
      <footer><span><strong>{plan.hospital_count}</strong> active hospitals</span><button onClick={() => onEdit(plan.id)}>Edit plan <Edit3 /></button></footer>
    </article>)}</div>
    {!plans.length && <div className="sa-empty"><Boxes /><h3>No subscription plans</h3><p>Create the first plan to begin provisioning hospitals.</p><button className="sa-primary" onClick={onCreate}><Plus /> Create plan</button></div>}
  </>
}
