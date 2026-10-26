-- Reviewed contract for V1..V5, not an automatic production provisioner.
-- Run as the migration/owner role in a dedicated database AFTER migrations.
-- psql variables: database_name, migration_role, application_role (no passwords).
-- The isolated role test executes this exact file with safely quoted variables.
BEGIN;
SELECT set_config('clinic.policy_database', :'database_name', true);
SELECT set_config('clinic.policy_migrator', :'migration_role', true);
SELECT set_config('clinic.policy_runtime', :'application_role', true);
DO $$
DECLARE
    migrator text := current_setting('clinic.policy_migrator');
    runtime text := current_setting('clinic.policy_runtime');
    runtime_oid oid;
BEGIN
    IF current_database() <> current_setting('clinic.policy_database') OR current_user <> migrator
        OR migrator = runtime OR current_database() IN ('postgres', 'template0', 'template1') THEN
        RAISE EXCEPTION 'Wrong database or owner for access policy';
    END IF;
    SELECT oid INTO runtime_oid FROM pg_roles WHERE rolname = runtime;
    IF runtime_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime
        AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
        AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit) THEN
        RAISE EXCEPTION 'Runtime must be a distinct unprivileged NOINHERIT login';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = runtime_oid)
        OR EXISTS (SELECT 1 FROM pg_database WHERE datdba = runtime_oid)
        OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = runtime_oid)
        OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = runtime_oid)
        OR EXISTS (SELECT 1 FROM pg_proc WHERE proowner = runtime_oid) THEN
        RAISE EXCEPTION 'Runtime cannot own objects or be a member of another role';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba
        WHERE d.datname=current_database() AND r.rolname=migrator)
        OR NOT EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid=n.nspowner
        WHERE n.nspname='public' AND r.rolname=migrator)
        OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='public' AND r.rolname<>migrator)
        OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        JOIN pg_roles r ON r.oid=p.proowner WHERE n.nspname='public' AND r.rolname<>migrator)
        OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public', 'information_schema') AND nspname NOT LIKE 'pg\_%' ESCAPE '\') THEN
        RAISE EXCEPTION 'Database, public schema and their relations must belong to the migration role';
    END IF;
END $$;

REVOKE ALL PRIVILEGES ON DATABASE :"database_name" FROM PUBLIC, :"application_role";
GRANT CONNECT ON DATABASE :"database_name" TO :"application_role";
REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, :"application_role";
GRANT USAGE ON SCHEMA public TO :"application_role";
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC, :"application_role";
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, :"application_role";
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, :"application_role";

-- Table-level REVOKE does not remove old column ACLs. Reset those explicitly so
-- reapplying this contract cannot retain obsolete/broader UPDATE permissions.
DO $$
DECLARE item record;
BEGIN
    FOR item IN SELECT table_name, string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) AS columns
        FROM information_schema.columns WHERE table_schema='public' GROUP BY table_name
    LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, %I',
            item.columns, item.table_name, current_setting('clinic.policy_runtime'));
    END LOOP;
END $$;

GRANT SELECT, INSERT ON TABLE
    public.inventory_product, public.inventory_lot, public.inventory_command,
    public.inventory_movement, public.audit_event,
    public.purchase_supplier, public.purchase_order, public.purchase_line, public.purchase_receipt,
    public.operation_patient, public.operation_appointment, public.operation_appointment_event,
    public.cash_shift, public.cash_payment, public.cash_reversal,
    public.equipment_asset, public.equipment_maintenance
TO :"application_role";

GRANT UPDATE (result) ON public.inventory_command TO :"application_role";
GRANT UPDATE (quantity, quarantined) ON public.inventory_lot TO :"application_role";
GRANT UPDATE (cancelled, cancellation_reason) ON public.purchase_order TO :"application_role";
GRANT UPDATE (received) ON public.purchase_line TO :"application_role";
GRANT UPDATE (reference, full_name, normalized_name, birth_date, phone, email, version, updated_at)
    ON public.operation_patient TO :"application_role";
GRANT UPDATE (starts_at, ends_at, duration_minutes, service, practitioner, resource, source,
    external_reference, status, cancellation_reason, version, updated_at)
    ON public.operation_appointment TO :"application_role";
GRANT UPDATE (closing_command_id, closed_by, closed_at, counted_cash_cents, expected_cash_cents, closure_reason)
    ON public.cash_shift TO :"application_role";
GRANT UPDATE (status, version, updated_at) ON public.equipment_asset TO :"application_role";
GRANT USAGE ON SEQUENCE public.audit_event_id_seq TO :"application_role";

-- No grant to flyway_schema_history, no UPDATE of append-only history, and no
-- DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN/CREATE or sequence UPDATE/SELECT.
-- New migrations receive no automatic runtime grants: review this list first.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" REVOKE ALL ON TABLES FROM PUBLIC, :"application_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, :"application_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" REVOKE ALL ON SEQUENCES FROM PUBLIC, :"application_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, :"application_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" REVOKE ALL ON FUNCTIONS FROM PUBLIC, :"application_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, :"application_role";
COMMIT;
