import LabInvoiceDownloads from './LabInvoiceDownloads';
export async function loadLabFinanceBill(id:string,token:string){
  const response=await fetch(`${import.meta.env.VITE_API_URL??''}/api/v1/operations/finance/lab-invoices/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`}});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load laboratory invoice');return data;
}
export default function LabFinanceDownloads({row,token}:{row:Record<string,any>;token:string}){
  return <LabInvoiceDownloads bill={row} loadBill={()=>loadLabFinanceBill(row.invoice_id||row.id,token)}/>;
}
