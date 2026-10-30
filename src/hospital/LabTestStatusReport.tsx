import {useEffect,useState} from 'react';
import {FlaskConical,ChevronRight,RotateCcw,CalendarDays,CalendarCheck,CheckCheck,Search,ChevronDown,Printer,Info} from 'lucide-react';
import {hospitalClock} from './opd-workflow';
import {groupTestStatusRows,reportRegistrationTime,reportStatusLabel,testStatusPrintHtml,type TestStatusRow} from './lab-test-status-model';
import './laboratory-operations.css';
import './lab-test-status-report.css';

const API=import.meta.env.VITE_API_URL??'';
type Filter={from:string;to:string;test_id:string;search:string;test_search:string;status:'all'|'pending'|'conducted'};
type Result={rows:TestStatusRow[];total:number;page_size:number;summary:{total:number;pending:number;conducted:number}};
export default function LabTestStatusReport({token}:{token:string}){
  const [filters,setFilters]=useState<Filter>(()=>({from:hospitalClock().date,to:hospitalClock().date,test_id:'',search:'',test_search:'',status:'all'}));
  const [applied,setApplied]=useState(filters),[page,setPage]=useState(1),[refresh,setRefresh]=useState(0);
  const [tests,setTests]=useState<Array<{id:string;name:string}>>([]);
  const [result,setResult]=useState<Result>({rows:[],total:0,page_size:100,summary:{total:0,pending:0,conducted:0}}),[busy,setBusy]=useState(false),[printing,setPrinting]=useState(false),[error,setError]=useState('');
  async function request(path:string,signal?:AbortSignal){
    const response=await fetch(`${API}/api/v1/workspaces/lab${path}`,{headers:{Authorization:`Bearer ${token}`},signal});
    const data=await response.json();if(!response.ok)throw Error(data.error||'Unable to load report');return data;
  }
  const reportPath=(filter:Filter,number:number)=>`/test-status-report?${new URLSearchParams({...filter,page:String(number)})}`;
  const reportQuery=reportPath(applied,page);
  const filtersPending=JSON.stringify(filters)!==JSON.stringify(applied);
  useEffect(()=>{
    if(!filters.from||!filters.to||filters.from>filters.to){setError('Select a valid From Date and To Date.');return;}
    const timer=window.setTimeout(()=>{setApplied(filters);setPage(1);},300);
    return()=>window.clearTimeout(timer);
  },[filters]);
  useEffect(()=>{
    const controller=new AbortController();
    void request('/masters/test',controller.signal).then(setTests).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[token]);
  useEffect(()=>{
    const controller=new AbortController();setBusy(true);setError('');setResult({rows:[],total:0,page_size:100,summary:{total:0,pending:0,conducted:0}});
    void request(reportQuery,controller.signal).then(data=>{if(!controller.signal.aborted)setResult(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[token,reportQuery,refresh]);
  function apply(status:Filter['status']){
    if(!filters.from||!filters.to||filters.from>filters.to){setError('Select a valid From Date and To Date.');return;}
    setFilters(current=>({...current,status}));setApplied({...filters,status});setPage(1);setRefresh(value=>value+1);
  }
  async function print(){
    const popup=window.open('','_blank','width=1150,height=850');
    if(!popup){setError('Allow pop-ups to print this report.');return;}
    popup.document.body.textContent='Preparing all matching report rows…';setPrinting(true);setError('');
    try{
      let rows:TestStatusRow[]=[];let number=1,total=0;
      do{
        const data:Result=await request(reportPath(applied,number));
        total=data.total;rows=rows.concat(data.rows);
        if(!data.rows.length&&rows.length<total)throw Error('The report changed during printing. Refresh and print again.');
        number++;
      }while(rows.length<total);
      if(popup.closed)throw Error('Print window was closed.');
      const filterLabel=`${applied.status==='all'?'All Tests':applied.status==='pending'?'Pending Tests':'Conducted Tests'}${applied.search?` · Search: ${applied.search}`:''}${applied.test_search?` · Test name: ${applied.test_search}`:''}${applied.test_id?` · ${tests.find(test=>test.id===applied.test_id)?.name||'Selected test'}`:''}`;
      popup.document.open();popup.document.write(testStatusPrintHtml(rows,applied.from,applied.to,filterLabel));popup.document.close();
    }catch(e){popup.close();setError(e instanceof Error?e.message:'Unable to print report');}finally{setPrinting(false);}
  }
  const displayDate=(value:string)=>new Date(`${value}T00:00:00+05:30`).toLocaleDateString('en-US',{timeZone:'Asia/Kolkata',month:'short',day:'numeric',year:'numeric'});
  const summary=result.summary;
  return <section className="lab-test-status-report">
    <div className="lab-status-breadcrumb"><FlaskConical size={15}/><span>Laboratory Workspace</span><ChevronRight size={14}/><strong>Test Status Report</strong></div>
    <div className="lab-status-surface">
      <header className="lab-status-title">
        <div className="lab-status-heading"><span className="lab-status-heading-icon"><FlaskConical size={27}/></span><div><h1>Test Status Report</h1><p>Track pending and conducted tests by date, patient and investigation.</p></div></div>
        <button className="lab-status-refresh" disabled={busy||printing} onClick={()=>apply(filters.status)}><RotateCcw size={17} className={busy?'lab-status-spinning':''}/><span>Refresh</span></button>
      </header>
      <div className="lab-status-summary" aria-label="Test summary">
        <article className="lab-status-stat total"><span className="lab-status-stat-icon"><CalendarDays size={26}/></span><div><h2>Total Tests</h2><strong>{busy?'—':summary.total.toLocaleString('en-IN')}</strong></div></article>
        <article className="lab-status-stat pending"><span className="lab-status-stat-icon"><CalendarCheck size={26}/></span><div><h2>Pending Tests</h2><strong>{busy?'—':summary.pending.toLocaleString('en-IN')}</strong></div></article>
        <article className="lab-status-stat conducted"><span className="lab-status-stat-icon"><CheckCheck size={28}/></span><div><h2>Conducted Tests</h2><strong>{busy?'—':summary.conducted.toLocaleString('en-IN')}</strong></div></article>
      </div>
      <div className="lab-status-panel">
        <div className="lab-status-filters">
          <label>From Date<span className="lab-status-input"><CalendarDays size={16}/><input type="date" value={filters.from} max={filters.to} onChange={event=>setFilters(current=>({...current,from:event.target.value}))}/></span></label>
          <label>To Date<span className="lab-status-input"><CalendarDays size={16}/><input type="date" value={filters.to} min={filters.from} onChange={event=>setFilters(current=>({...current,to:event.target.value}))}/></span></label>
          <label>Find Test<span className="lab-status-input"><Search size={17}/><input placeholder="Type test name" value={filters.test_search} onChange={event=>setFilters(current=>({...current,test_search:event.target.value,test_id:""}))}/></span></label>
          <label>Select Test<span className="lab-status-input select"><select value={filters.test_id} onChange={event=>setFilters(current=>({...current,test_id:event.target.value}))}><option value="">All tests</option>{tests.filter(test=>test.id===filters.test_id||test.name.toLowerCase().includes(filters.test_search.trim().toLowerCase())).map(test=><option key={test.id} value={test.id}>{test.name}</option>)}</select><ChevronDown size={16}/></span></label>
          <label className="lab-status-search">Patient / UHID / Bill / Barcode<span className="lab-status-input"><Search size={17}/><input placeholder="Search patient, bill / barcode" value={filters.search} onChange={event=>setFilters(current=>({...current,search:event.target.value}))} onKeyDown={event=>{if(event.key==='Enter')apply(filters.status);}}/></span></label>
        </div>
        <div className="lab-status-actions">
          <div className="lab-status-view-buttons">{(['all','pending','conducted'] as const).map(status=><button key={status} className={`lab-status-view ${status} ${applied.status===status?'active':''}`} aria-pressed={applied.status===status} disabled={busy||printing} onClick={()=>apply(status)}>{status==='all'?'All Tests':status==='pending'?'Pending Tests':'Conducted Tests'}</button>)}</div>
          <button className="lab-status-print" disabled={busy||printing||filtersPending||!!error||!result.total} onClick={print}><Printer size={17}/>{printing?'Preparing print…':'Print Report'}</button>
        </div>
        {error&&<p className="lab-status-error" role="alert">{error}</p>}
        <div className="lab-status-results" aria-busy={busy}>
          <div className="lab-status-list-heading" role="status"><h2>Test Status List</h2><span>{displayDate(applied.from)} – {displayDate(applied.to)}</span><small>({busy?'Loading…':`${result.total.toLocaleString('en-IN')} tests`})</small></div>
          <p className="lab-status-note"><Info size={13}/>Done means all test results are saved. Partially completed tests are included in Pending Tests.</p>
          <div className="lab-status-table-scroll"><table><thead><tr><th>#</th><th>UHID</th><th>Bill No</th><th>Barcode IDs</th><th>Patient Name</th><th>Reg Time</th><th>Status</th></tr></thead>{groupTestStatusRows(result.rows).map(group=><tbody key={`${group.date}:${group.rows[0].test_id}`}><tr className="lab-status-group"><th colSpan={7}>DATE: {group.date} · {group.test} (TOTAL: {group.rows[0].group_total??group.rows.length})</th></tr>{group.rows.map((row,index)=><tr key={`${row.order_id}:${row.test_id}:${index}`}><td>{index+1}</td><td>{row.uhid||'—'}</td><td>{row.bill_number||'—'}</td><td>{row.barcode||'—'}</td><td>{row.patient_name}</td><td>{reportRegistrationTime(row.registered_at)}</td><td><span className={`lab-status-badge ${row.result_status==='Completed'?'done':row.result_status==='Partially Completed'?'partial':'pending'}`}>{reportStatusLabel(row.result_status)}</span></td></tr>)}</tbody>)}</table>{!busy&&!result.rows.length&&<div className="lab-status-empty"><FlaskConical size={30}/><p>No matching tests found for these filters.</p></div>}{busy&&<p className="lab-status-loading">Loading test status report…</p>}</div>
        </div>
        {(result.total>result.page_size||page>1)&&<footer className="lab-status-pagination"><span>{result.total.toLocaleString('en-IN')} tests · Page {page} of {Math.max(1,Math.ceil(result.total/result.page_size))}</span><button disabled={busy||printing||page===1} onClick={()=>setPage(value=>value-1)}>Previous</button><button disabled={busy||printing||page*result.page_size>=result.total} onClick={()=>setPage(value=>value+1)}>Next</button></footer>}
      </div>
    </div>
  </section>;
}
