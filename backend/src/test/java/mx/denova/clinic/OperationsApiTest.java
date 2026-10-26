package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OperationsApiTest {
    static final JwtFixture identity = new JwtFixture();
    static final HttpClient client = HttpClient.newHttpClient();
    static final String ROOT = "/api/v1/operations";
    // An isolated, generated schema prevents new foreign keys from cascading cleanup into other suites.
    static final String SCHEMA = "operations_test_" + UUID.randomUUID().toString().replace("-", "");
    static final String DB_URL = env("TEST_DB_URL", "jdbc:postgresql://127.0.0.1:5432/clinic_test");
    static final String DB_USER = env("TEST_DB_USER", "clinic_test");
    static final String DB_PASSWORD = env("TEST_DB_PASSWORD", "synthetic-ci-only");
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    String admin, reception, physician, auditor, pharmacy;
    Instant slot;

    @DynamicPropertySource static void configure(DynamicPropertyRegistry r) {
        new JdbcTemplate(new DriverManagerDataSource(DB_URL, DB_USER, DB_PASSWORD)).execute("CREATE SCHEMA IF NOT EXISTS " + SCHEMA);
        r.add("spring.datasource.url", () -> DB_URL + (DB_URL.contains("?") ? "&" : "?") + "currentSchema=" + SCHEMA);
        r.add("spring.datasource.username", () -> DB_USER);
        r.add("spring.datasource.password", () -> DB_PASSWORD);
        r.add("spring.flyway.user", () -> DB_USER);
        r.add("spring.flyway.password", () -> DB_PASSWORD);
        r.add("spring.flyway.default-schema", () -> SCHEMA);
        r.add("spring.flyway.schemas", () -> SCHEMA);
        r.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> identity.issuer);
        r.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri", identity::uri);
    }
    @BeforeEach void before() {
        assertEquals(SCHEMA, jdbc.queryForObject("SELECT current_schema()", String.class));
        jdbc.execute("TRUNCATE operation_appointment_event, operation_appointment, operation_patient, inventory_command, audit_event, equipment_maintenance, equipment_asset RESTART IDENTITY CASCADE");
        admin = identity.token("admin-operations", "ADMIN");
        reception = identity.token("reception-operations", "RECEPCION");
        physician = identity.token("physician-operations", "MEDICO");
        auditor = identity.token("auditor-operations", "AUDITOR");
        pharmacy = identity.token("pharmacy-operations", "FARMACIA");
        slot = Instant.now().plus(1, ChronoUnit.DAYS).truncatedTo(ChronoUnit.HOURS);
    }
    @AfterAll static void cleanup() {
        identity.close();
        new JdbcTemplate(new DriverManagerDataSource(DB_URL, DB_USER, DB_PASSWORD)).execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
    }

    @Test void enforcesRolesAndRejectsUnadvertisedMethods() throws Exception {
        assertEquals(401, get("/patients", null).statusCode());
        assertEquals(403, get("/patients", pharmacy).statusCode());
        for (String reader : List.of(admin, reception, physician, auditor)) assertEquals(200, get("/appointments", reader).statusCode());
        for (String reader : List.of(physician, auditor, pharmacy)) assertEquals(403, post("/patients", reader, UUID.randomUUID(), patientInput("DEMO-1", "Paciente Ejemplo")).statusCode());
        UUID patient = createPatient("DEMO-1", "Paciente Ejemplo");
        assertEquals(403, post("/appointments", auditor, UUID.randomUUID(), appointmentInput(patient, slot, "MEDICO-1", "SALA-1")).statusCode());
        assertEquals(403, request("DELETE", "/patients/" + patient, admin, null, null).statusCode());
    }
    @Test void patientRetryPersistsOneRecordAndConflictingKeysAreRejected() throws Exception {
        UUID key = UUID.randomUUID();
        var input = patientInput(" demo-1 ", "  Ángela   Ejemplo  ");
        var first = ok(post("/patients", reception, key, input), 201);
        assertEquals("DEMO-1", first.get("reference").asString());
        assertEquals("Ángela Ejemplo", first.get("fullName").asString());
        assertEquals(first, ok(post("/patients", reception, key, input), 201));
        assertEquals(409, post("/patients", admin, key, input).statusCode());
        assertEquals(409, post("/patients", reception, key, patientInput("DEMO-2", "Otro Paciente")).statusCode());
        assertEquals(first, ok(get("/patients/" + id(first), auditor), 200));
        assertEquals(1, count("operation_patient"));
        assertEquals(1, count("audit_event"));
    }
    @Test void validatesSyntheticDataAndRejectsClinicalFields() throws Exception {
        var input = patientInput("DEMO-1", "Paciente Ejemplo");
        input.put("synthetic", false);
        assertEquals(400, post("/patients", reception, UUID.randomUUID(), input).statusCode());
        input.put("synthetic", true); input.put("clinicalNotes", "No se aceptan notas");
        assertEquals(400, post("/patients", reception, UUID.randomUUID(), input).statusCode());
        input.remove("clinicalNotes"); input.put("birthDate", "2999-01-01");
        assertEquals(400, post("/patients", reception, UUID.randomUUID(), input).statusCode());
        input.put("birthDate", "1800-01-01");
        assertEquals(400, post("/patients", reception, UUID.randomUUID(), input).statusCode());
        input.put("birthDate", "1990-01-01"); input.put("email", "no-es-correo");
        assertEquals(400, post("/patients", reception, UUID.randomUUID(), input).statusCode());
        assertEquals(0, count("operation_patient"));
        assertEquals(0, count("inventory_command"));
    }
    @Test void homonymsRequireReviewAndRemainIndependent() throws Exception {
        UUID first = createPatient("DEMO-1", "José Ejemplo");
        var input = patientInput("DEMO-2", "JOSE EJEMPLO");
        input.put("birthDate", "1980-01-01");
        assertCode(post("/patients", reception, UUID.randomUUID(), input), "POSSIBLE_DUPLICATE");
        var candidates = ok(get("/patients/duplicates?fullName=" + encoded("jose ejemplo") + "&birthDate=1980-01-01", reception), 200).get("items");
        assertEquals(1, candidates.size());
        assertEquals(first.toString(), candidates.get(0).get("patient").get("id").asString());
        assertEquals("NAME", candidates.get(0).get("matchedOn").get(0).asString());
        input.put("duplicateReviewed", true);
        var second = ok(post("/patients", reception, UUID.randomUUID(), input), 201);
        assertNotEquals(first, id(second));
        assertEquals(2, count("operation_patient"));
        assertEquals(2, ok(get("/patients?q=JOSE", auditor), 200).get("items").size());
    }
    @Test void matchingBirthDateAndPhoneFindsPossibleDuplicateWithDifferentName() throws Exception {
        createPatient("DEMO-1", "Paciente de Ejemplo");
        var input = patientInput("DEMO-2", "Nombre escrito diferente");
        input.put("phone", "+52 (722) 123-4567");
        assertCode(post("/patients", reception, UUID.randomUUID(), input), "POSSIBLE_DUPLICATE");
        assertEquals(1, ok(get("/patients/duplicates?fullName=OTRO&birthDate=1990-01-01&phone=" + encoded("+527221234567"), reception), 200).get("items").size());
    }
    @Test void patientEditsUseVersionAndRollbackStaleChanges() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Inicial");
        var input = patientInput("DEMO-1", "Paciente Corregido"); input.put("expectedVersion", 0);
        UUID key = UUID.randomUUID();
        var updated = ok(post("/patients/" + patient + "/update", reception, key, input), 200);
        assertEquals(1, updated.get("version").asInt());
        assertEquals(updated, ok(post("/patients/" + patient + "/update", reception, key, input), 200));
        assertCode(post("/patients/" + patient + "/update", reception, UUID.randomUUID(), input), "VERSION_CONFLICT");
        assertEquals("Paciente Corregido", ok(get("/patients/" + patient, physician), 200).get("fullName").asString());
        assertEquals(2, count("audit_event"));
    }
    @Test void concurrentPatientEditsHaveOneWinner() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Inicial");
        var a = patientInput("DEMO-1", "Primera corrección"); a.put("expectedVersion", 0);
        var b = patientInput("DEMO-1", "Segunda corrección"); b.put("expectedVersion", 0);
        var responses = together(() -> post("/patients/" + patient + "/update", reception, UUID.randomUUID(), a), () -> post("/patients/" + patient + "/update", reception, UUID.randomUUID(), b));
        assertEquals(List.of(200,409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, ok(get("/patients/" + patient, reception), 200).get("version").asInt());
    }
    @Test void concurrentUnreviewedHomonymsCannotSilentlyCreateTwoPatients() throws Exception {
        var a = patientInput("DEMO-1", "Paciente Simultáneo");
        var b = patientInput("DEMO-2", "Paciente Simultáneo");
        var responses = together(() -> post("/patients", reception, UUID.randomUUID(), a), () -> post("/patients", reception, UUID.randomUUID(), b));
        assertEquals(List.of(201,409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, count("operation_patient"));
    }
    @Test void receptionAndPhysicianCompleteAuditedJourney() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Ejemplo");
        UUID appointment = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        assertCode(transition(appointment, physician, 0, "COMPLETED", null), "INVALID_TRANSITION");
        ok(transition(appointment, reception, 0, "ARRIVED", null), 200);
        assertEquals(403, transition(appointment, reception, 1, "IN_CONSULTATION", null).statusCode());
        ok(transition(appointment, physician, 1, "IN_CONSULTATION", null), 200);
        var finalState = ok(transition(appointment, physician, 2, "COMPLETED", null), 200);
        assertEquals("COMPLETED", finalState.get("status").asString());
        assertEquals(3, finalState.get("version").asInt());
        assertCode(transition(appointment, admin, 3, "CANCELLED", "Prueba"), "INVALID_TRANSITION");
        assertEquals(4, ok(get("/appointments/" + appointment + "/history", auditor), 200).get("items").size());
        assertEquals(5, count("audit_event"));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("DELETE FROM operation_appointment_event"));
    }
    @Test void cancellationRequiresReasonAndReleasesItsSlot() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Ejemplo");
        UUID appointment = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        assertEquals(400, transition(appointment, reception, 0, "CANCELLED", " ").statusCode());
        assertEquals("CANCELLED", ok(transition(appointment, reception, 0, "CANCELLED", "Cancelación sintética"), 200).get("status").asString());
        book(patient, slot, "MEDICO-1", "SALA-1");
        assertEquals(2, count("operation_appointment"));
    }
    @Test void overlapDetectsPatientPractitionerAndResourceButAllowsAdjacentSlots() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        UUID another = createDistinctPatient("DEMO-2", "Paciente Dos");
        book(patient, slot, "MEDICO-1", "SALA-1");
        for (var body : List.of(appointmentInput(patient, slot, "MEDICO-2", "SALA-2"), appointmentInput(another, slot, "MEDICO-1", "SALA-2"), appointmentInput(another, slot, "MEDICO-2", "SALA-1")))
            assertCode(post("/appointments", reception, UUID.randomUUID(), body), "SCHEDULE_CONFLICT");
        book(patient, slot.plusSeconds(1800), "MEDICO-1", "SALA-1");
        book(another, slot, "MEDICO-2", "SALA-2");
        assertEquals(3, count("operation_appointment"));
    }
    @Test void concurrentBookingsSerializeOverlapAndRetryHasOneEffect() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        var body = appointmentInput(patient, slot, "MEDICO-1", "SALA-1");
        var responses = together(() -> post("/appointments", reception, UUID.randomUUID(), body), () -> post("/appointments", reception, UUID.randomUUID(), body));
        assertEquals(List.of(201,409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        UUID key = UUID.randomUUID(); body.put("startsAt", slot.plusSeconds(3600).toString());
        var retries = together(() -> post("/appointments", reception, key, body), () -> post("/appointments", reception, key, body));
        assertEquals(ok(retries.get(0), 201), ok(retries.get(1), 201));
        assertEquals(2, count("operation_appointment"));
        assertEquals(2, count("operation_appointment_event"));
    }
    @Test void reschedulingPreservesSnapshotsAndRejectsStaleOrOverlappingWrites() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        UUID appointment = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        book(patient, slot.plusSeconds(3600), "MEDICO-1", "SALA-1");
        var body = appointmentInput(patient, slot.plusSeconds(3600), "MEDICO-1", "SALA-1");
        body.remove("patientId"); body.put("expectedVersion", 0);
        assertCode(post("/appointments/" + appointment + "/reschedule", reception, UUID.randomUUID(), body), "SCHEDULE_CONFLICT");
        body.put("startsAt", slot.plusSeconds(7200).toString());
        var changed = ok(post("/appointments/" + appointment + "/reschedule", reception, UUID.randomUUID(), body), 200);
        assertEquals(1, changed.get("version").asInt());
        assertCode(post("/appointments/" + appointment + "/reschedule", reception, UUID.randomUUID(), body), "VERSION_CONFLICT");
        var history = ok(get("/appointments/" + appointment + "/history", auditor), 200).get("items");
        assertEquals(slot, Instant.parse(history.get(0).get("startsAt").asString()));
        assertEquals(slot.plusSeconds(7200), Instant.parse(history.get(1).get("startsAt").asString()));
        ok(transition(appointment, reception, 1, "ARRIVED", null), 200);
        body.put("expectedVersion", 2);
        assertCode(post("/appointments/" + appointment + "/reschedule", reception, UUID.randomUUID(), body), "INVALID_TRANSITION");
    }
    @Test void transitionRetryIsStableAfterFurtherTransitions() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        UUID appointment = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        UUID key = UUID.randomUUID();
        var body = Map.of("expectedVersion", 0, "status", "ARRIVED");
        var first = ok(post("/appointments/" + appointment + "/transition", reception, key, body), 200);
        ok(transition(appointment, physician, 1, "IN_CONSULTATION", null), 200);
        assertEquals(first, ok(post("/appointments/" + appointment + "/transition", reception, key, body), 200));
        assertEquals("IN_CONSULTATION", ok(get("/appointments/" + appointment, physician), 200).get("status").asString());
        assertEquals(3, count("operation_appointment_event"));
    }
    @Test void delayedConsultationKeepsResourceBusyUntilCompleted() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        UUID another = createDistinctPatient("DEMO-2", "Paciente Dos");
        UUID first = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        UUID second = id(book(another, slot.plusSeconds(1800), "MEDICO-1", "SALA-1"));
        ok(transition(first, reception, 0, "ARRIVED", null), 200);
        ok(transition(second, reception, 0, "ARRIVED", null), 200);
        ok(transition(first, physician, 1, "IN_CONSULTATION", null), 200);
        assertCode(transition(second, physician, 1, "IN_CONSULTATION", null), "SCHEDULE_CONFLICT");
        ok(transition(first, physician, 2, "COMPLETED", null), 200);
        ok(transition(second, physician, 1, "IN_CONSULTATION", null), 200);
    }
    @Test void concurrentArrivalAndCancellationCannotLoseAStateChange() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        UUID appointment = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        var responses = together(() -> transition(appointment, reception, 0, "ARRIVED", null), () -> transition(appointment, reception, 0, "CANCELLED", "Cambio sintético"));
        assertEquals(List.of(200,409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, ok(get("/appointments/" + appointment, reception), 200).get("version").asInt());
        assertEquals(2, count("operation_appointment_event"));
    }
    @Test void doctoraliaRequiresManualReferenceAndDoesNotDuplicateExternalAppointment() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        var body = appointmentInput(patient, slot, "MEDICO-1", "SALA-1"); body.put("source", "DOCTORALIA_MANUAL");
        assertEquals(400, post("/appointments", reception, UUID.randomUUID(), body).statusCode());
        body.put("externalReference", "DOCTORALIA-DEMO-1");
        var booked = ok(post("/appointments", reception, UUID.randomUUID(), body), 201);
        assertEquals("DOCTORALIA_MANUAL", booked.get("source").asString());
        body.put("startsAt", slot.plusSeconds(3600).toString());
        assertEquals(409, post("/appointments", reception, UUID.randomUUID(), body).statusCode());
        assertEquals(1, count("operation_appointment"));
    }
    @Test void resourceAvailabilityBlocksBookingReschedulingAndConsultationStart() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        jdbc.update("INSERT INTO equipment_asset(id, reference, name, location, status) VALUES (?, 'SPIRO-1', 'Equipo sintético', 'Consultorio', 'MAINTENANCE')", UUID.randomUUID());
        var body = appointmentInput(patient, slot, "MEDICO-1", "SPIRO-1");
        assertCode(post("/appointments", reception, UUID.randomUUID(), body), "EQUIPMENT_UNAVAILABLE");
        UUID appointment = id(book(patient, slot, "MEDICO-1", "SALA-1"));
        body.remove("patientId"); body.put("expectedVersion", 0);
        assertCode(post("/appointments/" + appointment + "/reschedule", reception, UUID.randomUUID(), body), "EQUIPMENT_UNAVAILABLE");
        jdbc.update("UPDATE equipment_asset SET status = 'AVAILABLE' WHERE reference = 'SPIRO-1'");
        ok(post("/appointments/" + appointment + "/reschedule", reception, UUID.randomUUID(), body), 200);
        ok(transition(appointment, reception, 1, "ARRIVED", null), 200);
        jdbc.update("UPDATE equipment_asset SET status = 'OUT_OF_SERVICE' WHERE reference = 'SPIRO-1'");
        assertCode(transition(appointment, physician, 2, "IN_CONSULTATION", null), "EQUIPMENT_UNAVAILABLE");
        assertEquals("ARRIVED", ok(get("/appointments/" + appointment, reception), 200).get("status").asString());
    }
    @Test void filtersAreBoundedAndDoNotExposeMissingRecords() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        book(patient, slot, "MEDICO-1", "SALA-1");
        assertEquals(1, ok(get("/appointments?from=" + slot + "&to=" + slot.plusSeconds(86400) + "&status=BOOKED&patientId=" + patient, reception), 200).get("items").size());
        assertEquals(0, ok(get("/appointments?from=" + slot.minusSeconds(3600) + "&to=" + slot, reception), 200).get("items").size());
        for (String path : List.of("/patients?limit=101", "/patients?offset=-1", "/appointments?from=" + slot, "/appointments?from=" + slot + "&to=" + slot.plusSeconds(94L * 86400), "/patients/duplicates"))
            assertEquals(400, get(path, reception).statusCode());
        assertEquals(404, get("/patients/" + UUID.randomUUID(), reception).statusCode());
        assertEquals(404, get("/appointments/" + UUID.randomUUID() + "/history", reception).statusCode());
        assertEquals(0, ok(get("/patients?q=" + encoded("%"), reception), 200).get("items").size());
    }
    @Test void validatesAppointmentDurationAndUnknownPatientBeforePersistence() throws Exception {
        UUID patient = createPatient("DEMO-1", "Paciente Uno");
        var body = appointmentInput(patient, slot, "MEDICO-1", "SALA-1");
        body.put("durationMinutes", 2.5);
        assertEquals(400, post("/appointments", reception, UUID.randomUUID(), body).statusCode());
        body.put("durationMinutes", 481);
        assertEquals(400, post("/appointments", reception, UUID.randomUUID(), body).statusCode());
        body.put("durationMinutes", 30); body.put("startsAt", Instant.now().minus(5, ChronoUnit.DAYS).toString());
        assertEquals(400, post("/appointments", reception, UUID.randomUUID(), body).statusCode());
        body.put("startsAt", slot.toString()); body.put("patientId", UUID.randomUUID());
        assertEquals(404, post("/appointments", reception, UUID.randomUUID(), body).statusCode());
        assertEquals(0, count("operation_appointment"));
        assertEquals(1, count("inventory_command"));
    }

    static String env(String key, String fallback) { return System.getenv().getOrDefault(key, fallback); }
    static UUID id(JsonNode node) { return UUID.fromString(node.get("id").asString()); }
    static String encoded(String text) { return URLEncoder.encode(text, StandardCharsets.UTF_8); }
    static Map<String,Object> patientInput(String reference, String name) { return new HashMap<>(Map.of("reference", reference, "fullName", name, "birthDate", "1990-01-01", "phone", "+527221234567", "email", "synthetic@example.invalid", "duplicateReviewed", false, "synthetic", true)); }
    static Map<String,Object> appointmentInput(UUID patient, Instant startsAt, String practitioner, String resource) { return new HashMap<>(Map.of("patientId", patient, "startsAt", startsAt.toString(), "durationMinutes", 30, "service", "Consulta sintética", "practitioner", practitioner, "resource", resource, "source", "LOCAL")); }
    UUID createPatient(String reference, String name) throws Exception { return id(ok(post("/patients", reception, UUID.randomUUID(), patientInput(reference, name)), 201)); }
    UUID createDistinctPatient(String reference, String name) throws Exception { var body = patientInput(reference, name); body.put("phone", "+527220000000"); return id(ok(post("/patients", reception, UUID.randomUUID(), body), 201)); }
    JsonNode book(UUID patient, Instant when, String practitioner, String resource) throws Exception { return ok(post("/appointments", reception, UUID.randomUUID(), appointmentInput(patient, when, practitioner, resource)), 201); }
    HttpResponse<String> transition(UUID id, String token, long version, String status, String reason) throws Exception {
        var body = new HashMap<String,Object>(); body.put("expectedVersion", version); body.put("status", status); if (reason != null) body.put("reason", reason);
        return post("/appointments/" + id + "/transition", token, UUID.randomUUID(), body);
    }
    int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
    void assertCode(HttpResponse<String> response, String code) { assertEquals(code, ok(response, 409).get("code").asString()); }
    JsonNode ok(HttpResponse<String> response, int status) { assertEquals(status, response.statusCode(), response.body()); return json.readTree(response.body()); }
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
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + ROOT + path)).timeout(java.time.Duration.ofSeconds(20));
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (key != null) request.header("Idempotency-Key", key.toString());
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
