import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {db} from '../database.mjs';
import {config} from '../config.mjs';
const key=()=>createHash('sha256').update('patient-sms-gateway:'+config.JWT_SECRET).digest();
export function sealSmsKey(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(v=>v.toString('base64url')).join('.');}
function unseal(value){const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url'));const decipher=createDecipheriv('aes-256-gcm',key(),iv);decipher.setAuthTag(tag);return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');}
export async function smsSettings(){return db.collection('platform_sms_gateway').findOne({_id:'patient-otp'});}
export async function smsAvailable(){return Boolean((await smsSettings())?.enabled)||config.PATIENT_APP_OTP_MODE==='webhook';}
export async function sendGatewayOtp(mobile,code){
  const settings=await smsSettings();
  if(!settings?.enabled)throw Object.assign(Error('Enable and configure the SMS gateway first.'),{status:503});
  await deliverDove(settings,unseal(settings.encrypted_key),mobile,code);
}
export async function deliverDove(settings,apiKey,mobile,code,fetcher=globalThis.fetch){
  const url=new URL('https://mobicomm.dove-sms.com/submitsms.jsp');
  const values={user:settings.username,key:apiKey,mobile:mobile.replace(/^\+/,''),message:settings.message.replaceAll('{code}',code),senderid:settings.sender_id,accusage:'1'};
  if(settings.entity_param&&settings.entity_id)values[settings.entity_param]=settings.entity_id;
  if(settings.template_param&&settings.template_id)values[settings.template_param]=settings.template_id;
  url.search=new URLSearchParams(values).toString();
  try{
    const result=await fetcher(url,{signal:AbortSignal.timeout(10000),redirect:'error'});
    const reply=(await result.text()).trim();
    if(!result.ok||!settings.success_prefix||reply.length>4096||!reply.startsWith(settings.success_prefix))throw Error('Rejected');
  }catch{throw Object.assign(Error('SMS provider did not accept the message. Check gateway settings and balance.'),{status:503,code:'SMS_DELIVERY_FAILED'});}
}
