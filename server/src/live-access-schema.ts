export const liveAccessSchemaSql=`
CREATE OR REPLACE FUNCTION notify_access_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'last_login_at'-'updated_at')=(to_jsonb(OLD)-'last_login_at'-'updated_at') THEN RETURN NULL; END IF;
  PERFORM pg_notify('careframe_access_changed','refresh'); RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION install_access_notification_triggers() RETURNS void LANGUAGE plpgsql AS $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','hospitals','rbac_roles','rbac_user_roles','rbac_role_permissions','user_branch_access','user_department_access','hospital_modules','referral_partners'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.'||t) AND tgname='access_changed') THEN
      EXECUTE format('CREATE TRIGGER access_changed AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION notify_access_changed()',t);
      END IF;
    END IF;
  END LOOP;
END $$;
SELECT install_access_notification_triggers();`;
