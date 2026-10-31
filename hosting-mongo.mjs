// Single-port managed-hosting entry point for the native MongoDB API and React app.
import express from 'express';
import helmet from 'helmet';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import api from './server/mongo/app.mjs';
import {config} from './server/mongo/config.mjs';
import {client,initializeMongo} from './server/mongo/database.mjs';

const frontend=fileURLToPath(new URL('./dist/',import.meta.url));
const index=fileURLToPath(new URL('./dist/index.html',import.meta.url));
if(!existsSync(index))throw new Error('Frontend build missing. Run npm run build:hostinger on the hosting build service.');
await initializeMongo();
const app=express();
app.disable('x-powered-by');
app.use(helmet());
app.use((request,response,next)=>request.path==='/api'||request.path.startsWith('/api/')?api(request,response,next):next());
app.use(express.static(frontend,{index:false}));
app.get('/{*path}',(request,response,next)=>request.accepts('html')?response.set('Cache-Control','no-store').sendFile(index):next());
const server=app.listen(config.API_PORT,'0.0.0.0',()=>console.log(`Pushkar Clinic MongoDB web app listening on port ${config.API_PORT}`));
let stopping=false;
function shutdown(){
  if(stopping)return;stopping=true;
  const timeout=setTimeout(()=>process.exit(1),15000);timeout.unref();
  server.close(()=>{void client.close().then(()=>process.exit(0),()=>process.exit(1));});
}
process.on('SIGTERM',shutdown);
process.on('SIGINT',shutdown);
