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
  if(!settings.entity_id||!settings.template_id||!settings.sender_id||!settings.message?.includes('{code}'))
    throw Object.assign(Error('OTP delivery is missing the approved DLT sender, entity ID, template ID, or message. Check Super Admin > Platform Settings > Patient App · SMS Gateway.'),{status:503,code:'SMS_DLT_CONFIGURATION_MISSING'});
  await deliverDove(settings,unseal(settings.encrypted_key),mobile,code);
}
export async function deliverDove(settings,apiKey,mobile,code,fetcher=globalThis.fetch){
  const url=new URL('https://mobicomm.dove-sms.com/submitsms.jsp');
  url.search=new URLSearchParams({
    user:settings.username,
    key:apiKey,
    mobile,
    message:settings.message.replaceAll('{code}',code),
    senderid:settings.sender_id,
    accusage:'1',
    entityid:settings.entity_id,
    tempid:settings.template_id,
  }).toString();
  const options={method:'GET',signal:AbortSignal.timeout(10000),redirect:'error'};
  let result,reply;
  try{
    result=await fetcher(url,options);
    reply=(await result.text()).trim();
  }catch{throw Object.assign(Error('Could not reach the SMS provider. Check the gateway connection and try again.'),{status:503,code:'SMS_DELIVERY_FAILED'});}
  if(!result.ok||reply.length>4096||!settings.success_prefix||!reply.startsWith(settings.success_prefix)){
    const dltBlocked=/blocked[ _-]*dlt[ _-]*template/i.test(reply);
    throw Object.assign(Error(dltBlocked
      ?'The SMS provider rejected this DLT template. Check that the saved entity ID, template ID, sender ID, and message exactly match the approved template.'
      :'The SMS provider did not accept the message. Check the gateway settings, response prefix, and balance.'),{status:503,code:dltBlocked?'SMS_DLT_TEMPLATE_REJECTED':'SMS_DELIVERY_FAILED'});
  }
}
