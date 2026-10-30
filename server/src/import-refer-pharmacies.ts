import {pool} from './db.js';
import {importReferPharmacies} from './refer-pharmacy-import.js';
const client=await pool.connect();
try{console.log(JSON.stringify(await importReferPharmacies(client)));}
finally{client.release();await pool.end();}
