BEGIN;

CREATE TABLE rbac_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  name text NOT NULL, code citext NOT NULL, description text NOT NULL DEFAULT '',
  role_level integer NOT NULL DEFAULT 50, status text NOT NULL DEFAULT 'Active',
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,code)
);
CREATE TABLE rbac_permissions (
  code citext PRIMARY KEY, module text NOT NULL, action text NOT NULL, label text NOT NULL
);
CREATE TABLE rbac_role_permissions (
  role_id uuid NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  permission_code citext NOT NULL REFERENCES rbac_permissions(code) ON DELETE CASCADE,
  PRIMARY KEY(role_id,permission_code)
);
CREATE TABLE rbac_user_roles (
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES rbac_roles(id) ON DELETE CASCADE,
  PRIMARY KEY(tenant_id,user_id,role_id)
);
CREATE TABLE user_branch_access (
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  PRIMARY KEY(tenant_id,user_id,branch_id)
);
CREATE TABLE user_department_access (
  tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY(tenant_id,user_id,department_id)
);
CREATE TABLE account_security_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
