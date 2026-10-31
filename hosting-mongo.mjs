// Single-port managed-hosting entry point for the native MongoDB API and React app.
import express from 'express';
import helmet from 'helmet';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {config} from './server/mongo/config.mjs';
import {databaseDiagnostic} from './server/mongo/database-diagnostics.mjs';

const frontend=fileURLToPath(new URL('./dist/',import.meta.url));
const index=fileURLToPath(new URL('./dist/index.html',import.meta.url));
if(!existsSync(index))throw new Error('Frontend build missing. Run npm run build:hostinger on the hosting build service.');
let api,client,retryTimer,stopping=false,phase='initializing';
const app=express();
app.disable('x-powered-by');
app.use(helmet());
app.use((request,response,next)=>{
  if(request.path!=='/api'&&!request.path.startsWith('/api/'))return next();
  if(api)return api(request,response,next);
  response.set({'Cache-Control':'no-store','Retry-After':'5'}).status(503).json({code:phase==='initializing'?'DATABASE_INITIALIZING':'DATABASE_UNAVAILABLE',error:phase==='initializing'?'Database is initializing. Retry shortly.':'Database unavailable. Check Atlas Network Access and private server settings.'});
});
app.use(express.static(frontend,{index:false}));
app.get('/{*path}',(request,response,next)=>request.accepts('html')?response.set('Cache-Control','no-store').sendFile(index):next());
// Hostinger requires listen() within three seconds. Import the API and initialize
// MongoDB afterward; never expose API operations before indexes and owner setup finish.
const server=app.listen(config.API_PORT,'0.0.0.0',()=>{
  console.log(`Pushkar Clinic web app listening on port ${config.API_PORT}`);
  void initializeBackend();
});
async function initializeBackend(){
  let stage='backend-import';
  try{
    const database=await import('./server/mongo/database.mjs');client=database.client;
    const [{default:backend},{ensureInitialAdministrator}]=await Promise.all([import('./server/mongo/app.mjs'),import('./server/mongo/initial-administrator.mjs')]);
    if(stopping)return;
    await database.initializeMongo();
    if(stopping)return;
    stage='owner-setup';await ensureInitialAdministrator(config);
    if(stopping)return;
    api=backend;console.log('MongoDB API ready.');
  }catch(error){
    if(stopping)return;
    phase='unavailable';
    const diagnostic=databaseDiagnostic(error,stage);
    console.error(`Database initialization failed [stage=${diagnostic.stage}, code=${diagnostic.code??'unknown'}]. ${diagnostic.hint} Retrying.`);
    retryTimer=setTimeout(()=>{void initializeBackend();},5000);
  }
}
function shutdown(){
  if(stopping)return;stopping=true;
  clearTimeout(retryTimer);
  const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();
  server.close(()=>{void Promise.resolve(client?.close()).then(()=>process.exit(0),()=>process.exit(1));});
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
