DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'anon',
    'authenticated',
    'authenticator',
    'dashboard_user',
    'pgbouncer',
    'service_role',
    'supabase_admin',
    'supabase_auth_admin',
    'supabase_functions_admin',
    'supabase_read_only_user',
    'supabase_realtime_admin',
    'supabase_replication_admin',
    'supabase_storage_admin'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I', role_name);
    END IF;
  END LOOP;
END
$$;
