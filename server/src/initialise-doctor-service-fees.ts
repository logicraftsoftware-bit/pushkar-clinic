import {pool} from './db.js';
import {initialiseDoctorServiceFees} from './doctor-service-fees.js';
const client=await pool.connect();
try{console.log('DOCTOR_SERVICE_FEES',JSON.stringify(await initialiseDoctorServiceFees(client)));}
finally{client.release();await pool.end();}
