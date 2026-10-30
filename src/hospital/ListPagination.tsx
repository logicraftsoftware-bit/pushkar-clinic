import './list-pagination.css';

export default function ListPagination({page,total,pageSize=25,count,busy,onPage,label}:{page:number;total:number;pageSize?:number;count:number;busy:boolean;onPage:(page:number)=>void;label:string}){
  const pages=Math.max(1,Math.ceil(total/pageSize)),start=(page-1)*pageSize;
  return <footer className="list-pagination"><span>Showing {total?start+1:0} to {Math.min(start+count,total)} of {total.toLocaleString('en-IN')} records</span><nav aria-label={`${label} pagination`}><button disabled={busy||page<=1} onClick={()=>onPage(page-1)}>Previous</button><span>Page {page} of {pages}</span><button disabled={busy||page>=pages} onClick={()=>onPage(page+1)}>Next</button></nav></footer>;
}
