package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import mx.denova.clinic.api.ApiProblem;
import mx.denova.clinic.equipment.EquipmentService;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EquipmentApiTest {
    static final JwtFixture identity = new JwtFixture();
    static final HttpClient client = HttpClient.newHttpClient();
    static final String ROOT = "/api/v1/equipment/assets";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    @Autowired EquipmentService equipment;
    @Autowired PlatformTransactionManager transactions;
    String admin;

    @DynamicPropertySource static void configure(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", () -> env("TEST_DB_URL", "jdbc:postgresql://127.0.0.1:5432/clinic_test"));
        r.add("spring.datasource.username", () -> env("TEST_DB_USER", "clinic_test"));
        r.add("spring.datasource.password", () -> env("TEST_DB_PASSWORD", "synthetic-ci-only"));
        r.add("spring.flyway.user", () -> env("TEST_DB_USER", "clinic_test"));
        r.add("spring.flyway.password", () -> env("TEST_DB_PASSWORD", "synthetic-ci-only"));
        r.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> identity.issuer);
        r.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri", identity::uri);
    }
    static String env(String key, String fallback) { return System.getenv().getOrDefault(key, fallback); }
    @BeforeEach void before() {
        jdbc.execute("TRUNCATE equipment_maintenance, equipment_asset, audit_event, inventory_command RESTART IDENTITY CASCADE");
        admin = identity.token("admin-equipment", "ADMIN");
    }
    @AfterAll static void stopIdentity() { identity.close(); }

    @Test void rolesAllowOperationalReadsAndRestrictAllMutationsToAdmin() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        assertEquals(401, get(ROOT, null).statusCode());
        assertEquals(403, get(ROOT, identity.token("unknown", "UNKNOWN")).statusCode());
        for (String role : List.of("RECEPCION", "MEDICO", "AUDITOR", "FARMACIA")) {
            String token = identity.token("reader-" + role, role);
            assertEquals(200, get(ROOT, token).statusCode());
            assertEquals(200, get(ROOT + "/" + id, token).statusCode());
            assertEquals(200, get(history(id), token).statusCode());
            assertEquals(403, post(ROOT, token, UUID.randomUUID(), assetInput("EQ-OTHER")).statusCode());
            assertEquals(403, post(state(id), token, UUID.randomUUID(), status("MAINTENANCE", 0)).statusCode());
            assertEquals(403, post(history(id), token, UUID.randomUUID(), maintenance(0)).statusCode());
        }
        assertEquals(403, request("DELETE", ROOT + "/" + id, admin, null, null).statusCode());
        assertEquals(403, request("PUT", ROOT + "/" + id, admin, null, assetInput("EQ-OTHER")).statusCode());
        assertEquals(1, count("equipment_asset"));
        assertEquals(0, count("equipment_maintenance"));
        assertEquals(1, count("inventory_command"));
    }

    @Test void assetsAreNormalizedUniqueAndIdempotentWithoutConsumableStockEffects() throws Exception {
        UUID key = UUID.randomUUID();
        var input = new HashMap<>(assetInput(" eq-demo "));
        input.put("serialNumber", " SN-001 ");
        var asset = ok(post(ROOT, admin, key, input), 201);
        assertEquals("EQ-DEMO", asset.get("reference").asString());
        assertEquals("SN-001", asset.get("serialNumber").asString());
        assertEquals("AVAILABLE", asset.get("status").asString());
        assertEquals(0, asset.get("version").asLong());
        assertTrue(asset.get("nextDueOn").isNull());
        assertEquals(asset, ok(post(ROOT, admin, key, input), 201));
        assertEquals(asset, ok(get(ROOT + "/" + id(asset), admin), 200));
        assertEquals(409, post(ROOT, admin, UUID.randomUUID(), input).statusCode());
        assertEquals(1, count("equipment_asset"));
        assertEquals(1, count("inventory_command"));
        assertEquals(1, count("audit_event"));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM inventory_movement WHERE command_id = ?", Integer.class, key));
    }

    @Test void invalidAssetFieldsAndUnsupportedClientPropertiesAreRejected() throws Exception {
        for (String field : List.of("reference", "name", "location")) {
            var input = new HashMap<>(assetInput("EQ-DEMO"));
            input.put(field, "   ");
            assertEquals(400, post(ROOT, admin, UUID.randomUUID(), input).statusCode());
            input.remove(field);
            assertEquals(400, post(ROOT, admin, UUID.randomUUID(), input).statusCode());
        }
        var input = new HashMap<>(assetInput("EQ-DEMO"));
        input.put("serialNumber", "x".repeat(121));
        assertEquals(400, post(ROOT, admin, UUID.randomUUID(), input).statusCode());
        input.remove("serialNumber"); input.put("status", "AVAILABLE");
        assertEquals(400, post(ROOT, admin, UUID.randomUUID(), input).statusCode());
        assertEquals(400, post(ROOT, admin, null, assetInput("EQ-DEMO")).statusCode());
        assertEquals(0, count("equipment_asset"));
        assertEquals(0, count("inventory_command"));
    }

    @Test void assetSearchIsBoundedFilterableAndLiteral() throws Exception {
        var first = create("EQ-A"); create("EQ-B");
        ok(post(state(id(first)), admin, UUID.randomUUID(), status("MAINTENANCE", 0)), 200);
        assertEquals(1, ok(get(ROOT + "?status=AVAILABLE", admin), 200).get("items").size());
        assertEquals("EQ-A", ok(get(ROOT + "?q=eq-a", admin), 200).get("items").get(0).get("reference").asString());
        assertEquals(0, ok(get(ROOT + "?q=%25", admin), 200).get("items").size());
        assertEquals("EQ-B", ok(get(ROOT + "?limit=1&offset=1", admin), 200).get("items").get(0).get("reference").asString());
        assertEquals(400, get(ROOT + "?limit=101", admin).statusCode());
        assertEquals(400, get(ROOT + "?offset=-1", admin).statusCode());
        assertEquals(400, get(ROOT + "?q=" + "a".repeat(161), admin).statusCode());
        assertEquals(400, get(ROOT + "?status=UNKNOWN", admin).statusCode());
    }

    @Test void statusChangesRequireCurrentVersionAndAreAuditedWithAuthenticatedActor() throws Exception {
        UUID id = id(create("EQ-DEMO")), key = UUID.randomUUID();
        var input = status("MAINTENANCE", 0);
        var changed = ok(post(state(id), admin, key, input), 200);
        assertEquals(1, changed.get("version").asLong());
        assertEquals("MAINTENANCE", changed.get("status").asString());
        assertEquals(changed, ok(post(state(id), admin, key, input), 200));
        assertEquals("STALE_VERSION", ok(post(state(id), admin, UUID.randomUUID(), status("AVAILABLE", 0)), 409).get("code").asString());
        assertEquals("EQUIPMENT_SAME_STATUS", ok(post(state(id), admin, UUID.randomUUID(), status("MAINTENANCE", 1)), 409).get("code").asString());
        var missingVersion = new HashMap<>(status("AVAILABLE", 1)); missingVersion.remove("expectedVersion");
        assertEquals(400, post(state(id), admin, UUID.randomUUID(), missingVersion).statusCode());
        var emptyReason = new HashMap<>(status("AVAILABLE", 1)); emptyReason.put("reason", " ");
        assertEquals(400, post(state(id), admin, UUID.randomUUID(), emptyReason).statusCode());
        assertEquals(2, count("audit_event"));
        assertEquals("admin-equipment", jdbc.queryForObject("SELECT actor FROM audit_event WHERE command_id = ?", String.class, key));
        assertTrue(jdbc.queryForObject("SELECT reason FROM audit_event WHERE command_id = ?", String.class, key).contains("AVAILABLE → MAINTENANCE"));
        assertEquals(2, count("inventory_command"));
    }

    @Test void maintenancePersistsWithoutImplicitReleaseAndSetsNextIntervention() throws Exception {
        UUID id = id(create("EQ-DEMO")), key = UUID.randomUUID();
        ok(post(state(id), admin, UUID.randomUUID(), status("MAINTENANCE", 0)), 200);
        var entry = ok(post(history(id), admin, key, maintenance(1)), 201);
        assertEquals(2, entry.get("assetVersion").asLong());
        assertEquals("admin-equipment", entry.get("actor").asString());
        assertEquals(entry, ok(post(history(id), admin, key, maintenance(1)), 201));
        assertEquals(entry, ok(get(history(id), admin), 200).get("items").get(0));
        var asset = ok(get(ROOT + "/" + id, admin), 200);
        assertEquals("MAINTENANCE", asset.get("status").asString());
        assertEquals(today().plusMonths(6).toString(), asset.get("nextDueOn").asString());
        assertEquals(2, asset.get("version").asLong());
        assertEquals(1, count("equipment_maintenance"));
        assertEquals(3, count("audit_event"));
    }

    @Test void historicalEntriesDoNotOverwriteNewerScheduleAndSameDayLatestEntryWins() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        ok(post(history(id), admin, UUID.randomUUID(), maintenance(0)), 201);
        var historical = new HashMap<>(maintenance(1));
        historical.put("performedOn", today().minusYears(1).toString());
        historical.put("nextDueOn", today().minusMonths(6).toString());
        ok(post(history(id), admin, UUID.randomUUID(), historical), 201);
        assertEquals(today().plusMonths(6).toString(), ok(get(ROOT + "/" + id, admin), 200).get("nextDueOn").asString());
        var latest = new HashMap<>(maintenance(2)); latest.remove("nextDueOn");
        ok(post(history(id), admin, UUID.randomUUID(), latest), 201);
        assertTrue(ok(get(ROOT + "/" + id, admin), 200).get("nextDueOn").isNull());
        var entries = ok(get(history(id), admin), 200).get("items");
        assertEquals(3, entries.get(0).get("assetVersion").asLong());
        assertEquals(1, entries.get(1).get("assetVersion").asLong());
        assertEquals(2, entries.get(2).get("assetVersion").asLong());
    }

    @Test void maintenanceValidatesDatesVersionAndDescriptionBeforeAnyPersistence() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        for (String date : List.of(today().plusDays(1).toString(), "1899-12-31", "+10000-01-01")) {
            var input = new HashMap<>(maintenance(0)); input.put("performedOn", date);
            assertEquals(400, post(history(id), admin, UUID.randomUUID(), input).statusCode());
        }
        for (String date : List.of(today().toString(), today().minusDays(1).toString(), "+10000-01-01")) {
            var input = new HashMap<>(maintenance(0)); input.put("nextDueOn", date);
            assertEquals(400, post(history(id), admin, UUID.randomUUID(), input).statusCode());
        }
        for (String field : List.of("performedOn", "description", "technician", "expectedVersion")) {
            var input = new HashMap<>(maintenance(0)); input.remove(field);
            assertEquals(400, post(history(id), admin, UUID.randomUUID(), input).statusCode());
        }
        var input = new HashMap<>(maintenance(0)); input.put("description", " ");
        assertEquals(400, post(history(id), admin, UUID.randomUUID(), input).statusCode());
        assertEquals(409, post(history(id), admin, UUID.randomUUID(), maintenance(1)).statusCode());
        assertEquals(0, count("equipment_maintenance"));
        assertEquals(1, count("inventory_command"));
        assertEquals(1, count("audit_event"));
        assertEquals(0, ok(get(ROOT + "/" + id, admin), 200).get("version").asLong());
    }

    @Test void idempotencyCannotBeReusedAcrossBodyActorOrAsset() throws Exception {
        UUID first = id(create("EQ-A")), second = id(create("EQ-B")), key = UUID.randomUUID();
        ok(post(history(first), admin, key, maintenance(0)), 201);
        var changed = new HashMap<>(maintenance(0)); changed.put("description", "Otro registro sintético");
        assertEquals(409, post(history(first), admin, key, changed).statusCode());
        assertEquals(409, post(history(first), identity.token("different-admin", "ADMIN"), key, maintenance(0)).statusCode());
        assertEquals(409, post(history(second), admin, key, maintenance(0)).statusCode());
        assertEquals(1, count("equipment_maintenance"));
        assertEquals(3, count("inventory_command"));
    }

    @Test void historyAndAuditRejectUpdateAndDeleteAtDatabaseBoundary() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        ok(post(history(id), admin, UUID.randomUUID(), maintenance(0)), 201);
        assertThrows(DataAccessException.class, () -> jdbc.update("UPDATE equipment_maintenance SET description = 'Alterado'"));
        assertThrows(DataAccessException.class, () -> jdbc.update("DELETE FROM equipment_maintenance"));
        assertThrows(DataAccessException.class, () -> jdbc.update("DELETE FROM audit_event WHERE entity_id = ?", id));
        assertEquals(1, count("equipment_maintenance"));
        assertEquals(2, count("audit_event"));
    }

    @Test void concurrentStatusChangesDoNotLoseAnotherOperatorsWork() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        var responses = together(() -> post(state(id), admin, UUID.randomUUID(), status("MAINTENANCE", 0)),
                () -> post(state(id), admin, UUID.randomUUID(), status("OUT_OF_SERVICE", 0)));
        assertEquals(List.of(200, 409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, ok(get(ROOT + "/" + id, admin), 200).get("version").asLong());
        assertEquals(2, count("inventory_command"));
        assertEquals(2, count("audit_event"));
    }

    @Test void concurrentMaintenanceRetryRecordsExactlyOneIntervention() throws Exception {
        UUID id = id(create("EQ-DEMO")), key = UUID.randomUUID();
        var responses = together(() -> post(history(id), admin, key, maintenance(0)),
                () -> post(history(id), admin, key, maintenance(0)));
        assertEquals(ok(responses.get(0), 201), ok(responses.get(1), 201));
        assertEquals(1, count("equipment_maintenance"));
        assertEquals(1, ok(get(ROOT + "/" + id, admin), 200).get("version").asLong());
        assertEquals(2, count("audit_event"));
    }

    @Test void maintenanceAndAvailabilityShareTheSameConcurrencyVersion() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        var responses = together(() -> post(history(id), admin, UUID.randomUUID(), maintenance(0)),
                () -> post(state(id), admin, UUID.randomUUID(), status("OUT_OF_SERVICE", 0)));
        boolean maintenanceWon = responses.get(0).statusCode() == 201;
        assertEquals(maintenanceWon ? 409 : 200, responses.get(1).statusCode());
        assertEquals(maintenanceWon ? 201 : 409, responses.get(0).statusCode());
        assertEquals(maintenanceWon ? 1 : 0, count("equipment_maintenance"));
        var asset = ok(get(ROOT + "/" + id, admin), 200);
        assertEquals(maintenanceWon ? "AVAILABLE" : "OUT_OF_SERVICE", asset.get("status").asString());
        assertEquals(1, asset.get("version").asLong());
        assertEquals(2, count("inventory_command"));
        assertEquals(2, count("audit_event"));
    }

    @Test void missingAssetsAndInvalidPagesAreRejectedWithoutOrphanCommands() throws Exception {
        UUID missing = UUID.randomUUID();
        assertEquals(404, get(ROOT + "/" + missing, admin).statusCode());
        assertEquals(404, get(history(missing), admin).statusCode());
        assertEquals(404, post(history(missing), admin, UUID.randomUUID(), maintenance(0)).statusCode());
        assertEquals(404, post(state(missing), admin, UUID.randomUUID(), status("MAINTENANCE", 0)).statusCode());
        UUID id = id(create("EQ-DEMO"));
        assertEquals(400, get(history(id) + "?limit=101", admin).statusCode());
        assertEquals(400, get(history(id) + "?offset=-1", admin).statusCode());
        assertEquals(1, count("inventory_command"));
    }

    @Test void agendaAvailabilityGuardKeepsGenericResourcesAndRejectsUnavailableEquipment() throws Exception {
        UUID id = id(create("EQ-DEMO"));
        var tx = new TransactionTemplate(transactions);
        tx.executeWithoutResult(s -> equipment.assertResourceAvailable("CONSULTORIO-1"));
        tx.executeWithoutResult(s -> equipment.assertResourceAvailable("EQ-DEMO"));
        ok(post(state(id), admin, UUID.randomUUID(), status("MAINTENANCE", 0)), 200);
        var error = assertThrows(ApiProblem.class,
                () -> tx.executeWithoutResult(s -> equipment.assertResourceAvailable("EQ-DEMO")));
        assertEquals("EQUIPMENT_UNAVAILABLE", error.code);
        ok(post(state(id), admin, UUID.randomUUID(), status("AVAILABLE", 1)), 200);
        tx.executeWithoutResult(s -> equipment.assertResourceAvailable("EQ-DEMO"));
    }

    @Test void repeatedWhitespaceInEquipmentReferenceCannotBypassAgendaAvailability() throws Exception {
        var asset = create("  eq  \t demo  ");
        assertEquals("EQ DEMO", asset.get("reference").asString());
        ok(post(state(id(asset)), admin, UUID.randomUUID(), status("OUT_OF_SERVICE", 0)), 200);
        assertEquals(409, post(ROOT, admin, UUID.randomUUID(), assetInput("EQ DEMO")).statusCode());

        UUID patient = UUID.randomUUID(), command = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO operation_patient(id, reference, full_name, normalized_name, birth_date, synthetic)
            VALUES (?, ?, 'Paciente sintético de equipo', 'PACIENTE SINTETICO DE EQUIPO', ?, true)
            """, patient, patient.toString().toUpperCase(java.util.Locale.ROOT), LocalDate.of(1990, 1, 1));
        var appointment = Map.of("patientId", patient, "startsAt", java.time.Instant.now().plusSeconds(86400).toString(),
                "durationMinutes", 30, "service", "Consulta sintética", "practitioner", "MEDICO-" + patient,
                "resource", " eq   demo ", "source", "LOCAL");
        var denied = ok(post("/api/v1/operations/appointments", admin, command, appointment), 409);
        assertEquals("EQUIPMENT_UNAVAILABLE", denied.get("code").asString());
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM operation_appointment WHERE patient_id = ?", Integer.class, patient));
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM inventory_command WHERE id = ?", Integer.class, command));
    }

    static LocalDate today() { return LocalDate.now(ZoneId.of("America/Mexico_City")); }
    static UUID id(JsonNode value) { return UUID.fromString(value.get("id").asString()); }
    static String history(UUID id) { return ROOT + "/" + id + "/maintenance"; }
    static String state(UUID id) { return ROOT + "/" + id + "/status"; }
    static Map<String,Object> assetInput(String reference) {
        return Map.of("reference", reference, "name", "Equipo sintético", "location", "Consultorio de ejemplo");
    }
    static Map<String,Object> status(String status, long version) {
        return Map.of("status", status, "reason", "Cambio de disponibilidad de ejemplo", "expectedVersion", version);
    }
    static Map<String,Object> maintenance(long version) {
        return Map.of("performedOn", today().toString(), "nextDueOn", today().plusMonths(6).toString(),
                "description", "Inspección sintética de entrenamiento; sin certificación", "technician", "Técnico de ejemplo", "expectedVersion", version);
    }
    JsonNode create(String reference) throws Exception { return ok(post(ROOT, admin, UUID.randomUUID(), assetInput(reference)), 201); }
    int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
    JsonNode ok(HttpResponse<String> response, int code) { assertEquals(code, response.statusCode(), response.body()); return json.readTree(response.body()); }
    List<HttpResponse<String>> together(Callable<HttpResponse<String>> first, Callable<HttpResponse<String>> second) throws Exception {
        var start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var a = workers.submit(() -> { start.await(); return first.call(); });
            var b = workers.submit(() -> { start.await(); return second.call(); });
            start.countDown(); return List.of(a.get(), b.get());
        }
    }
    HttpResponse<String> get(String path, String token) throws Exception { return request("GET", path, token, null, null); }
    HttpResponse<String> post(String path, String token, UUID key, Object body) throws Exception { return request("POST", path, token, key, body); }
    HttpResponse<String> request(String method, String path, String token, UUID key, Object body) throws Exception {
        var r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(java.time.Duration.ofSeconds(20));
        if (token != null) r.header("Authorization", "Bearer " + token);
        if (key != null) r.header("Idempotency-Key", key.toString());
        if (body != null) r.header("Content-Type", "application/json");
        r.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        return client.send(r.build(), HttpResponse.BodyHandlers.ofString());
    }
}
