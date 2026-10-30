import { pool } from "./db.js";

export async function settingSection(tenantId:string, section:string) {
  const result=await pool.query<{key:string;value:unknown}>(`SELECT key,value FROM hospital_settings WHERE tenant_id=$1 AND section=$2`,[tenantId,section]);
  return Object.fromEntries(result.rows.map(row=>[row.key,row.value])) as Record<string,any>;
}

export async function configuredPrefix(tenantId:string,key:string,fallback:string) {
  const settings=await settingSection(tenantId,"PrefixSetting");
  const prefix=String(settings[key]??fallback).trim().replace(/[^a-z0-9_-]/gi,"").slice(0,20);
  return prefix||fallback;
}

export async function operationalSettings(tenantId:string) {
  const sections=["GeneralSetting","PaymentMethods","PrefixSetting","Languages","AttendanceSetting","NotificationSetting","SystemNotificationSetting"];
  const result=await pool.query<{key:string;value:unknown;section:string}>(
    `SELECT key,value,section FROM hospital_settings WHERE tenant_id=$1 AND section=ANY($2::text[])`,[tenantId,sections]);
  const [general={},payment={},prefix={},languages={},attendance={},notifications={},systemNotifications={}]=sections.map(section=>
    Object.fromEntries(result.rows.filter(row=>row.section===section).map(row=>[row.key,row.value])));
  const baseMethods=["Cash","Card","UPI","Bank Transfer","Cheque"];
  const gateway=String(payment.selected_gateway??"None");
  return {general,prefix,languages,attendance,notifications,systemNotifications,payment_methods:gateway!=="None"?[...baseMethods,gateway]:baseMethods};
}
