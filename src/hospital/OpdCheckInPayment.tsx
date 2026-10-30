import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CreditCard, LoaderCircle, X } from "lucide-react";

export type CheckInPayment = { amount: number; method: string; reference: string };
type Props = {
  appointment: Record<string, any>;
  methods: string[];
  onSave: (payment: CheckInPayment) => Promise<void>;
  onClose: () => void;
};

export default function OpdCheckInPayment({ appointment, methods, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const charges = Array.isArray(appointment.charges) ? appointment.charges.reduce((sum: number, row: { amount?: number }) => sum + Number(row.amount || 0), 0) : 0;
  const total = Math.max(0, Number(appointment.consultation_fee || 0) + charges - Number(appointment.discount || 0));
  const paid = Number(appointment.paid_amount || 0);
  const due = Math.round(Math.max(0, total - paid) * 100) / 100;
  const feeMissing = !Number(appointment.consultation_fee) && !charges && !Number(appointment.discount) && !paid;
  const [amount, setAmount] = useState(feeMissing ? "" : due.toFixed(2));
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const money = (value: number) => value.toLocaleString("en-IN", { style: "currency", currency: "INR" });
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>('input[type="number"]')?.focus();
    return () => element?.close();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true); setError("");
    try {
      await onSave({ amount: Number(amount), method, reference: reference.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save payment. Please try again.");
    } finally { submitting.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className="opd-checkin-dialog" aria-labelledby="opd-checkin-title" onCancel={event => { event.preventDefault(); if (!submitting.current) onClose(); }}>
    <form onSubmit={submit}>
      <header><span className="opd-overview-icon violet"><CreditCard size={22} /></span><div><h2 id="opd-checkin-title">Payment &amp; check-in</h2><p>{appointment.patient_name} &middot; {appointment.medical_record_number}</p></div><button type="button" className="opd-dialog-close" aria-label="Close payment" disabled={saving} onClick={onClose}><X size={19} /></button></header>
      <div className="opd-checkin-body">
        <div className="opd-checkin-summary"><div><small>Appointment total</small><strong>{money(total)}</strong></div><div><small>Already paid</small><strong>{money(paid)}</strong></div><div><small>Balance due</small><strong>{money(due)}</strong></div></div>
        {feeMissing && <p className="opd-checkin-hint">No consultation fee is recorded. The amount entered will be saved as the consultation fee. Enter 0 only if no payment is required.</p>}
        <label>Amount to collect (INR)<input autoFocus type="number" inputMode="decimal" min={due > 0 ? "0.01" : "0"} max={feeMissing ? "99999999.99" : due} step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} disabled={saving} placeholder="Enter amount" /></label>
        <label>Payment method<select required={Number(amount) > 0} value={method} onChange={event => setMethod(event.target.value)} disabled={saving || Number(amount) === 0}><option value="">Select payment method</option>{methods.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Reference number <span>(optional)</span><input type="text" maxLength={150} value={reference} onChange={event => setReference(event.target.value)} disabled={saving} placeholder="Transaction ID, UTR or receipt reference" /></label>
        {!feeMissing && Number(amount) > 0 && Number(amount) < due && <p className="opd-checkin-hint">Remaining balance: {money(due - Number(amount))}. This appointment will be marked partially paid.</p>}
        {error && <div className="opd-error" role="alert">{error}</div>}
      </div>
      <footer><button type="button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="opd-primary" disabled={saving}>{saving ? <LoaderCircle size={16} /> : <Check size={16} />}{saving ? "Saving..." : "Save & check in"}</button></footer>
    </form>
  </dialog>;
}
