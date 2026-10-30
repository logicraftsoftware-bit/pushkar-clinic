export const siteAuditSchemaSql=`
CREATE TABLE IF NOT EXISTS site_activity_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid,branch_id uuid,
 actor_id text,actor_name text NOT NULL,actor_role text NOT NULL,
 module text NOT NULL,record_id text NOT NULL,record_label text NOT NULL DEFAULT '',action text NOT NULL,
 changed_fields text[] NOT NULL DEFAULT '{}',ip_address text,request_path text,request_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE site_activity_events ADD COLUMN IF NOT EXISTS action_detail text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS site_activity_tenant_date ON site_activity_events(tenant_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS site_activity_record ON site_activity_events(tenant_id,module,record_id,id);
CREATE INDEX IF NOT EXISTS site_activity_actor ON site_activity_events(tenant_id,actor_id,created_at DESC);
CREATE OR REPLACE FUNCTION capture_site_activity() RETURNS trigger LANGUAGE plpgsql AS $audit$
DECLARE ctx jsonb;current_row jsonb;prior_row jsonb;keys jsonb;key_name text;record_key text:='';changed text[];tenant uuid;branch uuid;label text;
BEGIN
 ctx:=coalesce(nullif(current_setting('app.audit_context',true),'')::jsonb,'{}');
 current_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 prior_row:=CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE '{}' END;
 IF TG_OP='UPDATE' AND current_row=prior_row THEN RETURN NEW;END IF;
 tenant:=nullif(CASE WHEN TG_TABLE_NAME='hospitals' THEN current_row->>'id' ELSE coalesce(current_row->>'tenant_id',current_row->>'hospital_id',ctx->>'tenant_id') END,'')::uuid;
 branch:=nullif(CASE WHEN TG_TABLE_NAME='branches' THEN current_row->>'id' ELSE current_row->>'branch_id' END,'')::uuid;
 keys:=TG_ARGV[0]::jsonb;
 FOR key_name IN SELECT jsonb_array_elements_text(keys) LOOP
   record_key:=record_key||CASE WHEN record_key='' THEN '' ELSE ':' END||coalesce(current_row->>key_name,'');
 END LOOP;
 SELECT array_agg(k ORDER BY k) INTO changed FROM jsonb_object_keys(current_row) k
 WHERE TG_OP<>'UPDATE' OR (k NOT IN('updated_at','last_login_at') AND current_row->k IS DISTINCT FROM prior_row->k);
 IF TG_OP='UPDATE' AND changed IS NULL THEN RETURN NEW;END IF;
 label:=coalesce(current_row->>'record_number',current_row->>'appointment_number',current_row->>'request_number',current_row->>'ipd_number',current_row->>'medical_record_number',current_row->>'employee_id',current_row->>'name',current_row->'data'->>'bill_number',current_row->>'title',nullif(concat_ws(' ',current_row->>'first_name',current_row->>'last_name'),''),current_row->'data'->>'name',record_key);
 INSERT INTO site_activity_events(tenant_id,branch_id,actor_id,actor_name,actor_role,module,record_id,record_label,action,changed_fields,ip_address,request_path,request_id,action_detail)
 VALUES(tenant,branch,ctx->>'actor_id',coalesce(nullif(ctx->>'actor_name',''),'System'),coalesce(nullif(ctx->>'actor_role',''),'system'),TG_TABLE_NAME,record_key,label,CASE TG_OP WHEN 'INSERT' THEN 'Created' WHEN 'DELETE' THEN 'Deleted' ELSE 'Updated' END,coalesce(changed,'{}'),nullif(ctx->>'ip_address',''),ctx->>'request_path',ctx->>'request_id',coalesce(current_row->>'action',current_row->'data'->>'result_status',current_row->>'status',''));
 IF TG_OP='DELETE' THEN RETURN OLD;ELSE RETURN NEW;END IF;
END $audit$;
CREATE OR REPLACE FUNCTION install_site_audit_triggers() RETURNS void LANGUAGE plpgsql AS $install$
DECLARE item record;keys text;
BEGIN
 FOR item IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relname NOT IN('site_activity_events','hospital_audit_logs','login_activity','schema_migrations','migrations')
 AND EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary)
 AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='site_activity_capture' AND NOT t.tgisinternal)
 LOOP
   SELECT jsonb_agg(a.attname ORDER BY k.ordinality)::text INTO keys FROM pg_index i
   CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
   JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum WHERE i.indrelid=item.oid AND i.indisprimary;
   EXECUTE format('CREATE TRIGGER site_activity_capture AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION capture_site_activity(%L)',item.relname,keys);
 END LOOP;
 IF to_regprocedure('install_access_notification_triggers()') IS NOT NULL THEN EXECUTE 'SELECT install_access_notification_triggers()'; END IF;
END $install$;
SELECT install_site_audit_triggers();
ALTER TABLE cancellation_events ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE cancellation_events ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE cancellation_events ADD COLUMN IF NOT EXISTS ip_address text;
`;
