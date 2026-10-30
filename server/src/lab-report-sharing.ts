import {shareTokenHash} from "./lab-report-share-data.js";
export {shareTokenHash,newReportShareToken,decodeReportPdf} from "./lab-report-share-data.js";
import {Router} from "express";
import {pool} from "./db.js";
import {receptionReportAllowed} from "./reception-lab.js";
let schema:Promise<unknown>|undefined;
export function ensureReportShares(){return schema??=pool.query(`CREATE TABLE IF NOT EXISTS lab_report_shares(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES hospitals(id),order_id uuid NOT NULL REFERENCES role_work_items(id) ON DELETE CASCADE,token_hash text NOT NULL UNIQUE,pdf bytea NOT NULL,filename text NOT NULL,revision text NOT NULL,require_payment boolean NOT NULL DEFAULT false,created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days');CREATE INDEX IF NOT EXISTS lab_report_shares_expiry ON lab_report_shares(expires_at)`).catch(error=>{schema=undefined;throw error;});}
export const publicReportRouter=Router();
publicReportRouter.get("/:token",async(req,res)=>{
  const token=String(req.params.token);if(!/^[a-f0-9]{64}$/.test(token))return void res.status(404).send("Report link not found or expired");
  await ensureReportShares();
  const found=await pool.query(`SELECT s.pdf,s.filename,s.require_payment,w.data->'doctor_approval' approval,f.total,f.paid,f.due,f.status
    FROM lab_report_shares s JOIN role_work_items w ON w.id=s.order_id AND w.tenant_id=s.tenant_id
    LEFT JOIN finance_records f ON f.id=nullif(w.data->>'bill_id','')::uuid AND f.tenant_id=w.tenant_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND w.data->>'result_status' IN ('Completed','Partially Completed') AND w.data->'doctor_approval' IS NOT NULL AND w.data->'doctor_approval'<>'null'::jsonb
    AND s.revision=md5(jsonb_build_object('results',w.data->'lab_results','approval',w.data->'doctor_approval','technician',w.data->'technician_approval')::text)`,[shareTokenHash(token)]);
  const row=found.rows[0];if(!row||(row.require_payment&&!receptionReportAllowed(row,row.approval)))return void res.status(404).send("Report link not found, expired or no longer available");
  res.set({"Content-Type":"application/pdf","Content-Disposition":`inline; filename="${row.filename}"`,"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow","Referrer-Policy":"no-referrer"});res.send(row.pdf);
});
