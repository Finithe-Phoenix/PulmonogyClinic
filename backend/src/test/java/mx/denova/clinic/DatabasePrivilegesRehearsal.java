package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.parallel.Execution;
import org.junit.jupiter.api.parallel.ExecutionMode;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** Explicit -Dtest rehearsal only; never discovered by the normal *Test suite. */
@Execution(ExecutionMode.SAME_THREAD)
class DatabasePrivilegesRehearsal {
    private static final String suffix = UUID.randomUUID().toString().replace("-", "");
    private static final String database = "roles_fixture_" + suffix;
    private static final String migrator = "roles_migrator_" + suffix;
    private static final String runtime = "roles_runtime_" + suffix;
    private static final String ownerPassword = freshPassword();
    private static final String appPassword = freshPassword();
    private static String adminUrl, adminUser, adminPassword, url, policy;
    private static boolean createdOwner, createdRuntime, createdDatabase;
    private static final List<String> tables = List.of(
        "inventory_product", "inventory_lot", "inventory_command", "inventory_movement", "audit_event",
        "purchase_supplier", "purchase_order", "purchase_line", "purchase_receipt",
        "operation_patient", "operation_appointment", "operation_appointment_event",
        "cash_shift", "cash_payment", "cash_reversal", "equipment_asset", "equipment_maintenance");
    private static final Map<String, Set<String>> updates = Map.of(
        "inventory_command", Set.of("result"),
        "inventory_lot", Set.of("quantity", "quarantined"),
        "purchase_order", Set.of("cancelled", "cancellation_reason"),
        "purchase_line", Set.of("received"),
        "operation_patient", Set.of("reference", "full_name", "normalized_name", "birth_date", "phone", "email", "version", "updated_at"),
        "operation_appointment", Set.of("starts_at", "ends_at", "duration_minutes", "service", "practitioner", "resource", "source", "external_reference", "status", "cancellation_reason", "version", "updated_at"),
        "cash_shift", Set.of("closing_command_id", "closed_by", "closed_at", "counted_cash_cents", "expected_cash_cents", "closure_reason"),
        "equipment_asset", Set.of("status", "version", "updated_at"));

    @BeforeAll static void prepareExclusiveFixture() throws Exception {
        // No fallback to TEST_DB_*, clinic_test, clinic_dev or a developer secret.
        assertEquals("true", System.getenv("ROLE_TEST_ISOLATED"), "Explicit isolated rehearsal opt-in required");
        adminUrl = required("ROLE_TEST_DB_URL");
        assertTrue(adminUrl.matches("jdbc:postgresql://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?/clinic_roles_fixture"), "Only the dedicated fixture bootstrap database is accepted");
        adminUser = required("ROLE_TEST_DB_USER");
        assertEquals("roles_test_admin", adminUser, "Dedicated fixture administrator required");
        adminPassword = required("ROLE_TEST_DB_PASSWORD");
        policy = Files.readString(Path.of(required("ROLE_TEST_ACCESS_SQL")));
        url = adminUrl.substring(0, adminUrl.lastIndexOf('/') + 1) + database;
        try (var admin = DriverManager.getConnection(adminUrl, adminUser, adminPassword)) {
            assertEquals("clinic_roles_fixture", scalar(admin, "SELECT current_database()"));
            int version = Integer.parseInt(scalar(admin, "SHOW server_version_num"));
            assertTrue(version >= 170000 && version < 180000, "PostgreSQL 17 required");
            assertEquals("0", scalar(admin, "SELECT count(*) FROM pg_tables WHERE schemaname='public'"), "Bootstrap database must be empty");
            execute(admin, "CREATE ROLE " + ident(migrator) + " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD " + literal(ownerPassword));
            createdOwner = true;
            execute(admin, "CREATE ROLE " + ident(runtime) + " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD " + literal(appPassword));
            createdRuntime = true;
            execute(admin, "CREATE DATABASE " + ident(database) + " OWNER " + ident(migrator) + " TEMPLATE template0");
            createdDatabase = true;
        }
        try (var admin = DriverManager.getConnection(url, adminUser, adminPassword)) {
            execute(admin, "ALTER SCHEMA public OWNER TO " + ident(migrator));
        }
        Flyway.configure().dataSource(url, migrator, ownerPassword).cleanDisabled(true).load().migrate();
        try (var owner = owner()) { applyPolicy(owner); }
    }

    @BeforeEach void resetOnlyOwnedFixture() throws Exception {
        assertTrue(createdDatabase && database.equals("roles_fixture_" + suffix));
        try (var owner = owner()) {
            assertEquals(database, scalar(owner, "SELECT current_database()"));
            execute(owner, "TRUNCATE " + String.join(", ", tables.stream().map(DatabasePrivilegesRehearsal::ident).toList()) + " RESTART IDENTITY CASCADE");
        }
        // Positive writes, FK checks, row locking and audit sequence access all
        // run under the actual low-privilege LOGIN, not an admin SET ROLE.
        try (var app = app()) { execute(app, fixtureSql()); }
    }

    @Test void exactTableAndColumnPrivilegesMatchRuntimeSql() throws Exception {
        try (var owner = owner()) {
            assertEquals("18", scalar(owner, "SELECT count(*) FROM pg_tables WHERE schemaname='public'"));
            for (String table : tables) {
                for (String privilege : List.of("SELECT", "INSERT"))
                    assertTrue(tablePrivilege(owner, table, privilege), table + " " + privilege);
                for (String privilege : List.of("UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"))
                    assertFalse(tablePrivilege(owner, table, privilege), "No table-wide " + privilege + " on " + table);
                try (var query = owner.prepareStatement("SELECT column_name, has_column_privilege(?, 'public.' || table_name, column_name, 'UPDATE') FROM information_schema.columns WHERE table_schema='public' AND table_name=?")) {
                    query.setString(1, runtime); query.setString(2, table);
                    try (var rows = query.executeQuery()) {
                        while (rows.next()) assertEquals(updates.getOrDefault(table, Set.of()).contains(rows.getString(1)), rows.getBoolean(2), table + "." + rows.getString(1));
                    }
                }
            }
            for (String privilege : List.of("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"))
                assertFalse(tablePrivilege(owner, "flyway_schema_history", privilege));
            assertEquals("5", scalar(owner, "SELECT count(*) FROM flyway_schema_history WHERE success"));
        }
    }

    @Test void realRuntimeLoginCanReadEveryTableAndLockMutableRows() throws Exception {
        try (var app = app()) {
            assertEquals(runtime, scalar(app, "SELECT current_user"));
            for (String table : tables) assertTrue(Integer.parseInt(scalar(app, "SELECT count(*) FROM public." + ident(table))) > 0, table);
            for (String table : updates.keySet()) execute(app, "SELECT * FROM public." + ident(table) + " FOR UPDATE");
            assertEquals("7", scalar(app, "SELECT quantity FROM inventory_lot"));
            assertEquals("-345", scalar(app, "SELECT counted_cash_cents-expected_cash_cents FROM cash_shift"));
            assertEquals("9", scalar(app, "SELECT count(*) FROM audit_event"));
        }
    }

    @Test void runtimeCannotDeleteTruncateRewriteHistoryOrChangeProtectedColumns() throws Exception {
        try (var app = app()) {
            for (String table : tables) {
                denied(app, "DELETE FROM public." + ident(table) + " WHERE false");
                denied(app, "TRUNCATE public." + ident(table));
                // Identity assignments fail before ACL checks; use a protected ordinary column there.
                String protectedColumn = table.equals("audit_event") ? "command_id" : "id";
                denied(app, "UPDATE public." + ident(table) + " SET " + ident(protectedColumn) + "=" + ident(protectedColumn) + " WHERE false");
            }
            for (String table : List.of("inventory_movement", "audit_event", "purchase_receipt", "operation_appointment_event", "cash_payment", "cash_reversal", "equipment_maintenance"))
                denied(app, "UPDATE public." + ident(table) + " SET actor=actor WHERE false");
            denied(app, "UPDATE inventory_command SET request_hash=request_hash WHERE false");
            denied(app, "UPDATE inventory_lot SET expires_on=expires_on WHERE false");
            denied(app, "UPDATE cash_shift SET opening_float_cents=opening_float_cents WHERE false");
            denied(app, "UPDATE operation_patient SET synthetic=synthetic WHERE false");
        }
    }

    @Test void runtimeCannotDdlTouchFlywayResetSequenceOrEscalate() throws Exception {
        try (var app = app()) {
            for (String statement : List.of(
                "CREATE TABLE public.forbidden_probe(id integer)",
                "CREATE TEMP TABLE forbidden_probe(id integer)",
                "CREATE SCHEMA forbidden_probe",
                "ALTER TABLE inventory_product ADD COLUMN forbidden_probe integer",
                "DROP TABLE inventory_product",
                "SELECT * FROM flyway_schema_history",
                "UPDATE flyway_schema_history SET success=false WHERE false",
                "SELECT setval('audit_event_id_seq', 999999)",
                "SELECT last_value FROM audit_event_id_seq",
                "SET ROLE " + ident(migrator),
                "ALTER ROLE " + ident(runtime) + " SUPERUSER")) denied(app, statement);
            assertEquals(runtime, scalar(app, "SELECT current_user"));
            assertEquals("t", scalar(app, "SELECT has_sequence_privilege(current_user,'audit_event_id_seq','USAGE')"));
        }
    }

    @Test void ownerCanMigrateAndNewObjectsAreNotAutomaticallyExposed() throws Exception {
        Flyway.configure().dataSource(url, migrator, ownerPassword).cleanDisabled(true).load().validate();
        assertEquals(0, Flyway.configure().dataSource(url, migrator, ownerPassword).cleanDisabled(true).load().migrate().migrationsExecuted);
        try (var owner = owner()) {
            execute(owner, "CREATE TABLE public.role_policy_probe(id integer)");
            try {
                try (var app = app()) { denied(app, "SELECT * FROM public.role_policy_probe"); }
            } finally { execute(owner, "DROP TABLE public.role_policy_probe"); }
        }
    }

    @Test void reapplyingPolicyRemovesStaleColumnAndTableGrants() throws Exception {
        try (var owner = owner()) {
            try {
                execute(owner, "GRANT UPDATE(name) ON inventory_product TO " + ident(runtime));
                execute(owner, "GRANT TRUNCATE ON audit_event TO " + ident(runtime));
                applyPolicy(owner);
                try (var app = app()) {
                    denied(app, "UPDATE inventory_product SET name=name WHERE false");
                    denied(app, "TRUNCATE audit_event");
                }
            } finally { applyPolicy(owner); }
        }
    }

    @Test void springRuntimeStartsWithFlywayExplicitlyDisabledAndOnlyAppCredentials() throws Exception {
        try (var identity = new JwtFixture()) {
        var properties = new LinkedHashMap<String, Object>();
        properties.put("DB_URL", url); properties.put("DB_USER", runtime); properties.put("DB_PASSWORD", appPassword);
        properties.put("FLYWAY_ENABLED", "false"); properties.put("PORT", "0");
        properties.put("OIDC_ISSUER_URI", identity.issuer);
        properties.put("OIDC_JWK_SET_URI", identity.uri());
        properties.put("server.address", "127.0.0.1");
        properties.put("spring.main.banner-mode", "off"); properties.put("logging.level.root", "ERROR");
        var environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("isolated-role-rehearsal", properties));
        try (var context = new SpringApplicationBuilder(ClinicApplication.class).environment(environment).run()) {
            assertEquals(Boolean.FALSE, context.getEnvironment().getProperty("spring.flyway.enabled", Boolean.class));
            assertTrue(context.getBeansOfType(Flyway.class).isEmpty(), "Runtime must not construct a migrator");
            assertEquals(runtime, context.getBean(JdbcTemplate.class).queryForObject("SELECT current_user", String.class));
            assertEquals(1, context.getBean(JdbcTemplate.class).queryForObject("SELECT count(*) FROM inventory_product", Integer.class));
            var api = new Api(context.getEnvironment().getRequiredProperty("local.server.port", Integer.class),
                identity.token("SYNTHETIC-ROLE-HTTP", "ADMIN"), context.getBean(ObjectMapper.class), HttpClient.newHttpClient());
            exerciseAllModulesOverHttp(api);
        }
        }
    }

    private static void exerciseAllModulesOverHttp(Api api) throws Exception {
        String inventory = "/api/v1/inventory", purchasing = "/api/v1/purchasing", operations = "/api/v1/operations";
        String product = api.post(inventory + "/products", Map.of("sku", "HTTP-ROLE-PRODUCT", "name", "Producto HTTP sintético", "category", "INSUMOS", "unit", "pieza", "minimumStock", 2), 201).get("id").asString();
        String lot = api.post(inventory + "/lots", Map.of("productId", product, "batch", "HTTP-ROLE-LOT", "quarantined", false), 201).get("id").asString();
        api.post(inventory + "/lots/" + lot + "/movements", Map.of("kind", "RECEIPT", "quantity", 10, "reason", "Entrada sintética"), 201);
        assertEquals(7, api.post(inventory + "/lots/" + lot + "/movements", Map.of("kind", "ISSUE", "quantity", 3, "reason", "Salida sintética"), 201).get("balanceAfter").asInt());
        api.post(inventory + "/lots/" + lot + "/quarantine", Map.of("quarantined", true, "reason", "Control sintético"), 200);
        api.post(inventory + "/lots/" + lot + "/quarantine", Map.of("quarantined", false, "reason", "Control sintético"), 200);

        String supplier = api.post(purchasing + "/suppliers", Map.of("reference", "HTTP-ROLE-SUPPLIER", "name", "Proveedor HTTP sintético"), 201).get("id").asString();
        var today = LocalDate.now(ZoneId.of("America/Mexico_City"));
        var order = api.post(purchasing + "/orders", Map.of("reference", "HTTP-ROLE-ORDER", "supplierId", supplier, "expectedOn", today.plusDays(1).toString(),
            "lines", List.of(Map.of("productId", product, "quantity", 10, "unitCostCents", 1500))), 201);
        String orderId = order.get("id").asString();
        api.post(purchasing + "/orders/" + orderId + "/receipts", Map.of("reference", "HTTP-ROLE-RECEIPT", "lineId", order.get("lines").get(0).get("id").asString(),
            "quantity", 3, "batch", "HTTP-ROLE-LOT", "quarantined", false), 201);
        assertEquals("CANCELLED", api.post(purchasing + "/orders/" + orderId + "/cancel", Map.of("reason", "Saldo sintético"), 200).get("status").asString());
        assertEquals(10, api.get(inventory + "/lots/" + lot).get("quantity").asInt());

        String asset = api.post("/api/v1/equipment/assets", Map.of("reference", "HTTP-ROLE-EQUIPMENT", "name", "Equipo HTTP sintético", "location", "Sala sintética"), 201).get("id").asString();
        var patientBody = new LinkedHashMap<String, Object>(Map.of("reference", "HTTP-ROLE-PATIENT", "fullName", "Paciente HTTP de ensayo", "birthDate", "2000-01-01", "duplicateReviewed", false, "synthetic", true));
        String patient = api.post(operations + "/patients", patientBody, 201).get("id").asString();
        patientBody.put("expectedVersion", 0);
        patientBody.put("fullName", "Paciente HTTP actualizado sintético");
        api.post(operations + "/patients/" + patient + "/update", patientBody, 200);
        var slot = today.plusDays(1).atTime(10, 0).atZone(ZoneId.of("America/Mexico_City")).toInstant();
        var appointmentBody = new LinkedHashMap<String, Object>(Map.of("patientId", patient, "startsAt", slot.toString(), "durationMinutes", 30,
            "service", "Servicio sintético", "practitioner", "HTTP-ROLE-PRACTITIONER", "resource", "HTTP-ROLE-EQUIPMENT", "source", "LOCAL"));
        String appointment = api.post(operations + "/appointments", appointmentBody, 201).get("id").asString();
        appointmentBody.remove("patientId"); appointmentBody.put("expectedVersion", 0); appointmentBody.put("startsAt", slot.plusSeconds(3600).toString());
        api.post(operations + "/appointments/" + appointment + "/reschedule", appointmentBody, 200);
        int version = 1;
        for (String status : List.of("ARRIVED", "IN_CONSULTATION", "COMPLETED"))
            assertEquals(status, api.post(operations + "/appointments/" + appointment + "/transition", Map.of("expectedVersion", version++, "status", status), 200).get("status").asString());
        assertEquals(5, api.get(operations + "/appointments/" + appointment + "/history").get("items").size());
        api.post("/api/v1/equipment/assets/" + asset + "/status", Map.of("status", "MAINTENANCE", "reason", "Revisión sintética", "expectedVersion", 0), 200);
        api.post("/api/v1/equipment/assets/" + asset + "/maintenance", Map.of("performedOn", today.toString(), "nextDueOn", today.plusMonths(6).toString(),
            "description", "Ensayo sintético", "technician", "Técnico sintético", "expectedVersion", 1), 201);
        api.post("/api/v1/equipment/assets/" + asset + "/status", Map.of("status", "AVAILABLE", "reason", "Fin sintético", "expectedVersion", 2), 200);
        assertEquals(1, api.get("/api/v1/equipment/assets/" + asset + "/maintenance").get("items").size());

        String shift = api.post("/api/v1/cash/shifts", Map.of("reference", "HTTP-ROLE-SHIFT", "openingFloatCents", 10000), 201).get("id").asString();
        api.post("/api/v1/cash/shifts/" + shift + "/payments", Map.of("reference", "HTTP-ROLE-CASH", "amountCents", 12345, "method", "CASH"), 201);
        String card = api.post("/api/v1/cash/shifts/" + shift + "/payments", Map.of("reference", "HTTP-ROLE-CARD", "amountCents", 5010, "method", "CARD"), 201).get("id").asString();
        assertTrue(api.post("/api/v1/cash/payments/" + card + "/reverse", Map.of("reason", "Reverso sintético"), 200).get("reversed").asBoolean());
        assertEquals(-345, api.post("/api/v1/cash/shifts/" + shift + "/close", Map.of("countedCashCents", 22000, "reason", "Diferencia sintética"), 200).get("differenceCents").asLong());
        assertEquals(2, api.get("/api/v1/cash/shifts/" + shift + "/payments").get("items").size());
        assertTrue(api.get("/api/v1/audit/events").get("items").size() > 9);
    }

    private record Api(int port, String token, ObjectMapper json, HttpClient http) {
        JsonNode post(String path, Object body, int status) throws Exception { return request("POST", path, body, status); }
        JsonNode get(String path) throws Exception { return request("GET", path, null, 200); }
        private JsonNode request(String method, String path, Object body, int status) throws Exception {
            var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(Duration.ofSeconds(20))
                .header("Authorization", "Bearer " + token);
            if (body != null) request.header("Idempotency-Key", UUID.randomUUID().toString()).header("Content-Type", "application/json");
            request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
            var response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            assertEquals(status, response.statusCode(), method + " " + path + " (response values deliberately omitted)");
            return json.readTree(response.body());
        }
    }

    @AfterAll static void removeOnlyOwnedFixture() throws Exception {
        if (!createdOwner && !createdRuntime && !createdDatabase) return;
        assertTrue(database.equals("roles_fixture_" + suffix) && database.matches("roles_fixture_[a-f0-9]{32}"));
        List<Exception> errors = new ArrayList<>();
        try (var admin = DriverManager.getConnection(adminUrl, adminUser, adminPassword)) {
            if (createdDatabase) {
                try {
                    assertEquals(migrator, scalar(admin, "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=" + literal(database)));
                    execute(admin, "DROP DATABASE " + ident(database));
                    createdDatabase = false;
                } catch (Exception failure) { errors.add(failure); }
            }
            // No CASCADE, DROP OWNED, forced termination, existing role adoption,
            // or shared database truncation. A failed cleanup fails the rehearsal.
            if (!createdDatabase) {
                if (createdRuntime) try { execute(admin, "DROP ROLE " + ident(runtime)); createdRuntime = false; } catch (Exception failure) { errors.add(failure); }
                if (createdOwner) try { execute(admin, "DROP ROLE " + ident(migrator)); createdOwner = false; } catch (Exception failure) { errors.add(failure); }
            }
        }
        assertTrue(errors.isEmpty(), "Owned role fixture cleanup failed; inspect only this rehearsal's isolated container");
    }

    private static void applyPolicy(Connection owner) throws SQLException {
        String rendered = policy;
        for (var entry : Map.of("database_name", database, "migration_role", migrator, "application_role", runtime).entrySet())
            rendered = rendered.replace(":" + '"' + entry.getKey() + '"', ident(entry.getValue()))
                .replace(":'" + entry.getKey() + "'", literal(entry.getValue()));
        assertFalse(rendered.contains(":\""));
        execute(owner, rendered);
    }
    private static String fixtureSql() {
        // Fixed IDs are safe because the database is unique to this run.
        return """
            BEGIN;
            INSERT INTO inventory_command(id,request_hash,actor)
                SELECT ('00000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,repeat('a',64),'SYNTHETIC-ROLE-TEST' FROM generate_series(1,9) n;
            UPDATE inventory_command SET result='{"synthetic":true}'::jsonb;
            INSERT INTO inventory_product VALUES('00000000-0000-4000-8000-000000000101','ROLE-PRODUCT','Producto sintético','INSUMOS','pieza',2);
            INSERT INTO inventory_lot VALUES('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000101','ROLE-LOT',null,10,false);
            UPDATE inventory_lot SET quantity=7,quarantined=false;
            INSERT INTO inventory_movement(id,command_id,lot_id,kind,quantity,balance_after,reason,actor) VALUES
                ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102','RECEIPT',10,10,'Ensayo sintético','SYNTHETIC-ROLE-TEST'),
                ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000102','ISSUE',3,7,'Ensayo sintético','SYNTHETIC-ROLE-TEST');
            INSERT INTO purchase_supplier VALUES('00000000-0000-4000-8000-000000000201','ROLE-SUPPLIER','Proveedor sintético');
            INSERT INTO purchase_order(id,reference,supplier_id,order_date,expected_on) VALUES('00000000-0000-4000-8000-000000000202','ROLE-ORDER','00000000-0000-4000-8000-000000000201','2026-01-01','2026-01-02');
            INSERT INTO purchase_line VALUES('00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000101',0,'ROLE-PRODUCT','Producto sintético','INSUMOS','pieza',12,0,12345);
            UPDATE purchase_line SET received=10;
            UPDATE purchase_order SET cancelled=true,cancellation_reason='Saldo sintético cancelado';
            INSERT INTO purchase_receipt(id,reference,command_id,order_id,line_id,lot_id,movement_id,batch,quarantined,quantity,unit_cost_cents,actor) VALUES
                ('00000000-0000-4000-8000-000000000204','ROLE-RECEIPT','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000203','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000103','ROLE-LOT',false,10,12345,'SYNTHETIC-ROLE-TEST');
            INSERT INTO operation_patient(id,reference,full_name,normalized_name,birth_date,synthetic) VALUES('00000000-0000-4000-8000-000000000301','ROLE-PATIENT','Paciente sintético','paciente sintetico','2000-01-01',true);
            UPDATE operation_patient SET reference=reference,full_name=full_name,normalized_name=normalized_name,birth_date=birth_date,phone=null,email=null,version=version+1,updated_at=now();
            INSERT INTO operation_appointment(id,patient_id,starts_at,ends_at,duration_minutes,service,practitioner,resource,source) VALUES
                ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000301','2026-01-02T10:00:00Z','2026-01-02T10:30:00Z',30,'Servicio sintético','ROLE-PRACTITIONER','ROLE-EQUIPMENT','LOCAL');
            UPDATE operation_appointment SET starts_at=starts_at,ends_at=ends_at,duration_minutes=duration_minutes,service=service,practitioner=practitioner,resource=resource,source=source,external_reference=null,status='ARRIVED',cancellation_reason=null,version=version+1,updated_at=now();
            INSERT INTO operation_appointment_event(id,appointment_id,command_id,action,from_status,to_status,version,starts_at,ends_at,practitioner,resource,reason,actor) VALUES
                ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000003','STATUS_CHANGED','BOOKED','ARRIVED',1,'2026-01-02T10:00:00Z','2026-01-02T10:30:00Z','ROLE-PRACTITIONER','ROLE-EQUIPMENT','Ensayo sintético','SYNTHETIC-ROLE-TEST');
            INSERT INTO cash_shift(id,reference,opening_command_id,opening_float_cents,opened_by) VALUES('00000000-0000-4000-8000-000000000401','ROLE-SHIFT','00000000-0000-4000-8000-000000000004',10000,'SYNTHETIC-ROLE-TEST');
            INSERT INTO cash_payment(id,shift_id,command_id,reference,amount_cents,method,actor) VALUES
                ('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000005','ROLE-CASH',12345,'CASH','SYNTHETIC-ROLE-TEST'),
                ('00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000006','ROLE-CARD',5010,'CARD','SYNTHETIC-ROLE-TEST');
            INSERT INTO cash_reversal(id,payment_id,command_id,reason,actor) VALUES('00000000-0000-4000-8000-000000000404','00000000-0000-4000-8000-000000000403','00000000-0000-4000-8000-000000000007','Reverso sintético','SYNTHETIC-ROLE-TEST');
            UPDATE cash_shift SET closing_command_id='00000000-0000-4000-8000-000000000008',closed_by='SYNTHETIC-ROLE-TEST',closed_at=clock_timestamp(),counted_cash_cents=22000,expected_cash_cents=22345,closure_reason='Diferencia sintética';
            INSERT INTO equipment_asset(id,reference,name,location,status) VALUES('00000000-0000-4000-8000-000000000501','ROLE-EQUIPMENT','Equipo sintético','Sala sintética','AVAILABLE');
            UPDATE equipment_asset SET status='MAINTENANCE',version=1,updated_at=now();
            INSERT INTO equipment_maintenance(id,asset_id,command_id,performed_on,description,technician,actor,asset_version) VALUES('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000009','2026-01-01','Ensayo sintético','Técnico sintético','SYNTHETIC-ROLE-TEST',1);
            INSERT INTO audit_event(command_id,action,entity_id,actor,reason) SELECT id,'ROLE_FIXTURE',id,actor,'Ensayo sintético' FROM inventory_command;
            COMMIT;
            """;
    }
    private static Connection owner() throws SQLException { return DriverManager.getConnection(url, migrator, ownerPassword); }
    private static Connection app() throws SQLException { return DriverManager.getConnection(url, runtime, appPassword); }
    private static void execute(Connection connection, String sql) throws SQLException { try (var statement = connection.createStatement()) { statement.execute(sql); } }
    private static String scalar(Connection connection, String sql) throws SQLException {
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(sql)) { assertTrue(rows.next()); return rows.getString(1); }
    }
    private static void denied(Connection connection, String sql) {
        var failure = assertThrows(SQLException.class, () -> execute(connection, sql), "Expected permission denial, not an append-only trigger or row-level check");
        assertEquals("42501", failure.getSQLState(), "Must fail with insufficient_privilege");
    }
    private static boolean tablePrivilege(Connection owner, String table, String privilege) throws SQLException {
        try (var query = owner.prepareStatement("SELECT has_table_privilege(?, ?, ?)")) {
            query.setString(1, runtime); query.setString(2, "public." + table); query.setString(3, privilege);
            try (var rows = query.executeQuery()) { assertTrue(rows.next()); return rows.getBoolean(1); }
        }
    }
    private static String required(String key) { var value = System.getenv(key); assertNotNull(value, key + " required"); assertFalse(value.isBlank(), key + " cannot be blank"); return value; }
    private static String ident(String value) { assertTrue(value.matches("[a-z_][a-z0-9_]*")); return '"' + value + '"'; }
    private static String literal(String value) { return "'" + value.replace("'", "''") + "'"; }
    private static String freshPassword() { byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes); return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes); }
}
