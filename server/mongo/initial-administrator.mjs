import {randomUUID} from 'node:crypto';
import {db} from './database.mjs';
import {hashPassword} from './security.mjs';
export async function ensureInitialAdministrator(settings){
  const username=settings.BOOTSTRAP_ADMIN_USERNAME,password=settings.BOOTSTRAP_ADMIN_PASSWORD;
  if(!username&&!password)return false;
  if(!username||!password)throw new Error('Set both private administrator bootstrap environment variables.');
  if(await db.collection('super_admin_users').findOne({},{projection:{_id:1}}))return false;
  const password_hash=await hashPassword(password),now=new Date();
  const result=await db.collection('super_admin_users').updateOne({_id:'initial-administrator'},{$setOnInsert:{id:randomUUID(),username:username.toLowerCase(),display_name:settings.BOOTSTRAP_ADMIN_NAME??'Clinic Owner',password_hash,is_active:true,session_version:0,created_at:now}},{upsert:true});
  return Boolean(result.upsertedCount);
}
