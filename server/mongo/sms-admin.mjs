import {Router} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {db} from './database.mjs';
import {smsSettings,sealSmsKey,sendGatewayOtp} from './patient-app/sms-gateway.mjs';
import {phone,rateLimit} from './patient-app/common.mjs';
const router=Router();
const parameter=z.string().regex(/^$|^[a-zA-Z_]{2,30}$/).refine(v=>!['key','user','mobile','message','senderid','accusage'].includes(v));
const input=z.object({enabled:z.boolean(),username:z.string().trim().max(100),api_key:z.string().trim().max(500).optional(),sender_id:z.string().trim().max(12),message:z.string().max(1000),entity_id:z.string().regex(/^\d*$/).max(30),template_id:z.string().regex(/^\d*$/).max(30),entity_param:parameter,template_param:parameter,success_prefix:z.string().trim().max(200)}).strict();
const safe=row=>{const {encrypted_key,_id,...fields}=row??{};return {...fields,has_api_key:Boolean(encrypted_key),provider:'Dove / mobiCOMM',endpoint:'https://mobicomm.dove-sms.com/submitsms.jsp'};};
router.get('/sms-gateway',async(_req,res)=>res.json(safe(await smsSettings())));
router.put('/sms-gateway',async(req,res)=>{
  const body=input.parse(req.body),old=await smsSettings();
  if(body.enabled&&(!body.username||!body.sender_id||!body.message.includes('{code}')||!body.success_prefix||(!body.api_key&&!old?.encrypted_key)))return res.status(400).json({error:'Enter the gateway user, API key, approved sender, message containing {code}, and documented success response prefix.'});
  if(body.entity_param&&body.entity_param===body.template_param)return res.status(400).json({error:'DLT parameter names must be different.'});
  const {api_key,...fields}=body;
  await db.collection('platform_sms_gateway').updateOne({_id:'patient-otp'},{$set:{...fields,...(api_key?{encrypted_key:sealSmsKey(api_key)}:{}),updated_at:new Date(),updated_by:res.locals.account.id}},{upsert:true});
  await db.collection('platform_events').insertOne({id:randomUUID(),source:'sms',severity:'info',event_type:'sms_gateway_updated',message:'Patient OTP gateway settings updated',actor_id:res.locals.account.id,created_at:new Date()});
  res.json(safe(await smsSettings()));
});
router.post('/sms-gateway/test',async(req,res)=>{
  const body=z.object({phone}).strict().parse(req.body);await rateLimit(`sms-test:${res.locals.account.id}`,3,3600);
  await sendGatewayOtp(body.phone,'000000');
  res.json({message:'Test message accepted by the gateway. Check delivery in the SMS panel. This code cannot sign in.'});
});
export default router;
