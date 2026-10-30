// Only initialize a disposable database process on a GitHub Actions runner.
import {MongoClient} from 'mongodb';
if(process.env.GITHUB_ACTIONS!=='true')throw new Error('This helper is restricted to GitHub Actions.');
const client=new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true',{serverSelectionTimeoutMS:2000});
try{
  let connected=false;
  for(let attempt=0;attempt<30;attempt++){
    try{await client.connect();await client.db('admin').command({ping:1});connected=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}
  }
  if(!connected)throw new Error('Disposable MongoDB did not start.');
  await client.db('admin').command({replSetInitiate:{_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]}});
  let primary=false;
  for(let attempt=0;attempt<60;attempt++){
    if((await client.db('admin').command({hello:1})).isWritablePrimary){primary=true;break;}
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
  if(!primary)throw new Error('Disposable MongoDB did not elect a primary.');
  console.log('Disposable GitHub test replica set ready.');
}finally{await client.close();}
