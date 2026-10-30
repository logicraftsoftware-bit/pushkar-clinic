import {scheduleDate} from './doctor-availability.js';
type Row=Record<string,any>;
export function dailyDoctorSchedule(startDate:string){
  return {from_time:'07:00',to_time:'22:00',max_slots:180,slot_mode:'capacity',start_date:startDate,end_date:'2028-12-31'};
}
export function configureDailyDoctorSchedule(professional:Row,startDate:string){
  const p=professional??{},recurring=dailyDoctorSchedule(startDate);
  const schedule=Array.isArray(p.appointment_schedule)?p.appointment_schedule:[];
  const within=(date:unknown)=>scheduleDate(date)>=startDate&&scheduleDate(date)<=recurring.end_date;
  const snapshot={appointment_schedule:schedule,appointment_default_schedule:p.appointment_default_schedule??null,
    appointment_unavailable_dates:p.appointment_unavailable_dates??[],maximum_appointments:p.maximum_appointments??null,slot_duration:p.slot_duration??null};
  return {...p,appointment_availability_backup:p.appointment_availability_backup??snapshot,
    appointment_five_minute_backup:p.appointment_five_minute_backup??snapshot,
    appointment_default_schedule:recurring,maximum_appointments:180,slot_duration:5,
    appointment_unavailable_dates:(p.appointment_unavailable_dates??[]).filter((date:unknown)=>!within(date)),
    appointment_schedule:schedule.map((day:Row)=>within(day.appointment_date)?{...day,from_time:'07:00',to_time:'22:00',max_slots:180,slot_mode:'capacity'}:day)};
}
