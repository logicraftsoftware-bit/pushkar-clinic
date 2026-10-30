import {increaseAllDoctorFees} from './doctor-fee-increase.js';
import {pool} from './db.js';
const client=await pool.connect();
try{console.log('DOCTOR_FEE_INCREASE',JSON.stringify(await increaseAllDoctorFees(client)));}
finally{client.release();await pool.end();}
