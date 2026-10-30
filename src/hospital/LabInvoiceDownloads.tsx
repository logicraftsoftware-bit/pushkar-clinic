import {useState} from 'react';
import {Download,Printer} from 'lucide-react';
import {downloadLabBillingPdf,printLabBillingPdf,type LabBillCopy} from './lab-billing-pdf';
type Row=Record<string,any>;
export default function LabInvoiceDownloads({bill,loadBill}:{bill:Row;loadBill?:()=>Promise<Row>}){
  const [busy,setBusy]=useState(''),[error,setError]=useState('');
  const payments:Row[]=bill.payments||[];
  async function download(copy:LabBillCopy){setBusy(copy);setError('');try{await downloadLabBillingPdf(loadBill?await loadBill():bill,copy);}catch(e){setError(e instanceof Error?e.message:'Unable to download bill');}finally{setBusy('');}}
  async function print(payment?:Row){setBusy(payment?.id||'full');setError('');try{await printLabBillingPdf(loadBill??bill,payment);}catch(e){setError(e instanceof Error?e.message:'Unable to print invoice');}finally{setBusy('');}}
  return <section className="lab-invoice-downloads"><div className="lab-invoice-download-heading"><div><h3>Bill downloads &amp; payment receipts</h3><p>Customer copy hides pharmacy details. Both copies show the same final payable amount.</p></div><div>
    <button type="button" disabled={!!busy} onClick={()=>download('customer')}><Download/>{busy==='customer'?'Preparing…':'Full Bill (Customer)'}</button>
    <button type="button" disabled={!!busy} onClick={()=>download('pharmacy')}><Download/>{busy==='pharmacy'?'Preparing…':'Pharmacy Bill'}</button>
    <button type="button" className="primary" disabled={!!busy} onClick={()=>print()}><Printer/>{busy==='full'?'Preparing…':'Print Full Bill'}</button>
  </div></div>
  {payments.length>0&&<div className="lab-invoice-payment-list">{payments.map((payment,index)=><div key={payment.id}><span><strong>{payment.data?.initial_payment?'Initial payment':`Payment ${index+1}`} · INR {Number(payment.amount).toFixed(2)}</strong><small>{String(payment.record_date||payment.created_at||'').slice(0,10)} · {payment.data?.payment_mode||'Mode not recorded'}</small><small>{payment.record_number}</small></span><button type="button" disabled={!!busy} onClick={()=>print(payment)}><Printer/>{busy===payment.id?'Preparing…':'Print Receipt'}</button></div>)}</div>}
  {Number(bill.paid)>payments.reduce((sum,row)=>sum+Number(row.amount),0)+.01&&<p>Earlier payments without separate receipts are included in the invoice total.</p>}
  {error&&<p role="alert" className="workspace-error">{error}</p>}</section>;
}
