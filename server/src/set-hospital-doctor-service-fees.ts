import {pool} from './db.js';
import {setHospitalDoctorServiceFees} from './hospital-doctor-service-fees.js';
const client=await pool.connect();
try{console.log('HOSPITAL_DOCTOR_SERVICE_FEES',JSON.stringify(await setHospitalDoctorServiceFees(client)));}
finally{client.release();await pool.end();}
