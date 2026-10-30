import {useEffect,useState} from 'react';
import LabInvoiceDownloads from './LabInvoiceDownloads';

type Row=Record<string,any>;
const money=(value:unknown)=>`INR ${Number(value||0).toFixed(2)}`;

export default function SavedLabBill({initialBill,loadBill,onClose,onNewOrder}:{initialBill:Row;loadBill:()=>Promise<Row>;onClose:()=>void;onNewOrder:()=>void}){
  const [bill,setBill]=useState(initialBill),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    loadBill().then(value=>{if(active)setBill(value);}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Unable to load complete bill');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[loadBill]);
  const tests:Row[]=bill.tests??bill.data?.tests??[];
  return <section className="lab-create-page"><header><div><h2>Laboratory bill saved</h2><p>{bill.record_number} · {bill.patient_name}</p></div></header>
    <div className="lab-own-body">
      {loading&&<p role="status">Loading complete bill and payment receipts…</p>}
      {error&&<p role="alert" className="workspace-error">{error}. Use a bill download or print button to retry loading the complete bill.</p>}
      <section className="lab-saved-invoice" aria-label="Full laboratory bill">
        <h3>Full Bill</h3>
        <dl className="lab-saved-invoice-details">
          <div><dt>Invoice number</dt><dd>{bill.record_number}</dd></div>
          <div><dt>Bill date</dt><dd>{String(bill.record_date||bill.created_at||'').slice(0,10)||'Not recorded'}</dd></div>
          <div><dt>Patient</dt><dd>{bill.patient_name||'Not recorded'}</dd></div>
          <div><dt>UHID</dt><dd>{bill.medical_record_number||'Not recorded'}</dd></div>
          <div><dt>Referred by</dt><dd>{bill.data?.referred_by_name||bill.data?.referred_by||bill.data?.doctor_name||'Self'}</dd></div>
          <div><dt>Center</dt><dd>{bill.data?.center||'Not recorded'}</dd></div>
          <div><dt>Payment mode</dt><dd>{bill.data?.payment_mode||'Not recorded'}</dd></div>
        </dl>
        <div className="lab-saved-invoice-table"><table className="lab-bill-table"><thead><tr><th>#</th><th>Test name</th><th>Amount</th></tr></thead><tbody>{tests.map((test,index)=><tr key={test.test_id??index}><td>{index+1}</td><td>{test.name}</td><td>{money(test.amount)}</td></tr>)}</tbody></table></div>
        <div className="lab-bill-totals">{[
          ['Subtotal',bill.amount],['Total discount',bill.data?.discount_amount],['Tax',bill.data?.tax_amount],['Bill total',bill.total],['Paid amount',bill.paid],['Balance due',bill.due],
        ].map(([label,value])=><p key={String(label)}><span>{label}</span><b>{money(value)}</b></p>)}</div>
      </section>
      <LabInvoiceDownloads bill={bill} loadBill={loadBill}/>
    </div>
    <footer><button type="button" onClick={onClose}>Back to lab orders</button><button type="button" className="primary" onClick={onNewOrder}>New Registration / Order</button></footer>
  </section>;
}
