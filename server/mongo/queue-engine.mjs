// One projection for staff, patient passes and physical displays. No patient data here.
export function queueSerial(row) { return Number(row.queue_serial || row.slot_serial || 0); }
export function queueStatus(row) {
  if (row.queue_skipped && !['Completed','Cancelled','No Show'].includes(row.status)) return 'Skipped';
  if (['Booked','Confirmed'].includes(row.status)) return 'Awaiting check-in';
  if (['Checked In','Waiting'].includes(row.status)) return 'Waiting';
  if (row.status === 'Present') return 'In Consultation';
  return row.status;
}
export function projectQueue(appointments, settings={}, state={}, now=new Date()) {
  const duration=Math.max(1,Math.min(120,Number(settings.average_consultation_minutes)||10))*60000;
  const sorted=[...appointments].sort((a,b)=>queueSerial(a)-queueSerial(b)||String(a.created_at).localeCompare(String(b.created_at))||a.id.localeCompare(b.id));
  const active=sorted.filter(row=>['In Consultation','Present'].includes(row.status)&&!row.queue_skipped);
  const waiting=sorted.filter(row=>['Booked','Confirmed','Checked In','Waiting'].includes(row.status)&&!row.queue_skipped);
  const skipped=sorted.filter(row=>queueStatus(row)==='Skipped');
  const current=active[0]??null;
  const actual=state.actual_start_at ?? active.map(row=>row.consultation_started_at).filter(Boolean).sort()[0] ?? null;
  const started=Boolean(actual);
  const scheduled=new Date(`${settings.date}T${settings.opd_start_time||'09:00'}:00+05:30`).getTime();
  const start=current?new Date(current.consultation_started_at||actual||now).getTime():null;
  const completedAt=sorted.filter(row=>row.consultation_completed_at).map(row=>new Date(row.consultation_completed_at).getTime());
  let next=started?Math.max(now.getTime(),current?start+duration:Math.max(new Date(actual).getTime(),...completedAt)):scheduled;
  const estimates=new Map();
  active.forEach(row=>estimates.set(row.id,new Date(row.consultation_started_at||actual||now).toISOString()));
  waiting.forEach(row=>{estimates.set(row.id,new Date(next).toISOString());next+=duration;});
  const rows=[...active,...waiting,...skipped,...sorted.filter(row=>['Completed','No Show','Cancelled'].includes(row.status))].map(row=>({
    id:row.id,serial:queueSerial(row),status:queueStatus(row),appointment_status:row.status,appointment_time:row.appointment_time,
    estimated_at:estimates.get(row.id)??null,started_at:row.consultation_started_at??null,completed_at:row.consultation_completed_at??null,
    call_id:row.queue_call_id??null,checked_in:!['Booked','Confirmed'].includes(row.status),
  }));
  return {status:started?'LIVE':'NOT STARTED',scheduled_start:settings.opd_start_time||'09:00',actual_start_at:actual,
    average_consultation_minutes:duration/60000,room:settings.room_chamber||'',current:rows.find(row=>row.id===current?.id)??null,
    next:rows.find(row=>row.id===waiting[0]?.id)??null,waiting_count:waiting.length,
    counts:{total:sorted.length,waiting:waiting.length,in_consultation:active.length,completed:sorted.filter(row=>row.status==='Completed').length,skipped:skipped.length,absent:sorted.filter(row=>row.status==='No Show').length},rows};
}
