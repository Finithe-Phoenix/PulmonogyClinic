package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
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
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class CashApiTest {
    static final JwtFixture identity = new JwtFixture();
    static final HttpClient client = HttpClient.newHttpClient();
    static final String ROOT = "/api/v1/cash";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    String admin, reception, auditor;
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
        // Execute only against the dedicated disposable test database, with suites serialized.
        // No TRUNCATE of shared command/audit tables is needed; per-request keys stay unique.
        jdbc.execute("TRUNCATE cash_reversal, cash_payment, cash_shift RESTART IDENTITY");
        admin = identity.token("admin-cash", "ADMIN");
        reception = identity.token("reception-cash", "RECEPCION");
        auditor = identity.token("auditor-cash", "AUDITOR");
    }
    @AfterAll static void stopIdentity() { identity.close(); }

    @Test void restrictsReadsWritesAndReversalsByRole() throws Exception {
        assertEquals(401, get(ROOT + "/shifts", null).statusCode());
        assertEquals(403, get(ROOT + "/shifts", identity.token("pharmacy", "FARMACIA")).statusCode());
        assertEquals(403, get(ROOT + "/shifts", identity.token("medic", "MEDICO")).statusCode());
        assertEquals(200, get(ROOT + "/shifts", auditor).statusCode());
        assertEquals(403, post(ROOT + "/shifts", auditor, UUID.randomUUID(), opening("AUDIT", 0)).statusCode());
        var shift = open(1000);
        var payment = pay(id(shift), "PAY-01", 125, "CASH");
        var path = ROOT + "/payments/" + id(payment) + "/reverse";
        assertEquals(403, post(path, reception, UUID.randomUUID(), Map.of("reason", "Corrección ficticia")).statusCode());
        assertEquals(403, post(path, auditor, UUID.randomUUID(), Map.of("reason", "Corrección ficticia")).statusCode());
        assertEquals(403, request("DELETE", ROOT + "/shifts/" + id(shift), admin, null, null).statusCode());
        assertEquals(403, request("PATCH", ROOT + "/shifts/" + id(shift), admin, UUID.randomUUID(), Map.of()).statusCode());
        assertEquals(0, count("cash_reversal"));
    }
    @Test void normalizesReferencesAndKeepsOneOpenShift() throws Exception {
        UUID key = UUID.randomUUID();
        var input = opening(" turno-demo ", 12345);
        var first = ok(post(ROOT + "/shifts", reception, key, input), 201);
        assertEquals("TURNO-DEMO", first.get("reference").asString());
        assertEquals("MXN", first.get("currency").asString());
        assertEquals("OPEN", first.get("status").asString());
        assertEquals(12345L, first.get("expectedCashCents").asLong());
        assertEquals(first, ok(post(ROOT + "/shifts", reception, key, input), 201));
        assertEquals(409, post(ROOT + "/shifts", reception, UUID.randomUUID(), opening("OTHER", 100)).statusCode());
        assertEquals(1, count("cash_shift"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE command_id = ?", Integer.class, key));
    }
    @Test void persistsExactMethodTotalsAndOperationReferenceAcrossIdentities() throws Exception {
        UUID shift = id(open(50000));
        var cash = pay(shift, "CASH-01", 12345, "CASH");
        pay(shift, "CARD-01", 23456, "CARD");
        var transfer = ok(post(ROOT + "/shifts/" + shift + "/payments", reception, UUID.randomUUID(),
            Map.of("reference", " TRANS-01 ", "amountCents", 34567, "method", "TRANSFER", "operationReference", " apt-demo-01 ")), 201);
        assertEquals("APT-DEMO-01", transfer.get("operationReference").asString());
        assertEquals(34567L, transfer.get("amountCents").asLong());
        assertEquals(12345L, cash.get("amountCents").asLong());
        var read = ok(get(ROOT + "/shifts/" + shift, auditor), 200);
        assertEquals(12345L, read.get("cashTotalCents").asLong());
        assertEquals(23456L, read.get("cardTotalCents").asLong());
        assertEquals(34567L, read.get("transferTotalCents").asLong());
        assertEquals(62345L, read.get("expectedCashCents").asLong());
        assertEquals(3, ok(get(ROOT + "/shifts/" + shift + "/payments", admin), 200).get("items").size());
        assertEquals(3, jdbc.queryForObject("SELECT count(*) FROM cash_payment WHERE shift_id = ?", Integer.class, shift));
    }
    @Test void requiresIntegerNonNegativeMoneyAndMandatoryFields() throws Exception {
        for (var invalid : List.of(Map.of("reference", "MISSING"), opening("NEGATIVE", -1), opening("EXCESS", 9000000000001L),
                Map.of("reference", "FRACTION", "openingFloatCents", 12.5))) {
            assertEquals(400, post(ROOT + "/shifts", reception, UUID.randomUUID(), invalid).statusCode());
        }
        UUID shift = id(open(0));
        String pay = ROOT + "/shifts/" + shift + "/payments";
        for (var invalid : List.of(payment("ZERO", 0, "CASH"), payment("NEG", -1, "CASH"),
                Map.of("reference", "FRAC", "amountCents", 20.3, "method", "CASH"),
                Map.of("reference", "MISSING", "method", "CASH"), payment("BADMETHOD", 1, "CRYPTO"))) {
            assertEquals(400, post(pay, reception, UUID.randomUUID(), invalid).statusCode());
        }
        assertEquals(400, post(pay, reception, null, payment("NO-KEY", 10, "CASH")).statusCode());
        assertEquals(400, post(ROOT + "/shifts/" + shift + "/close", reception, UUID.randomUUID(), Map.of("reason", "Missing count")).statusCode());
        assertEquals(400, post(ROOT + "/shifts/" + shift + "/close", reception, UUID.randomUUID(), Map.of("countedCashCents", 0, "reason", " ")).statusCode());
        assertEquals(0, count("cash_payment"));
    }
    @Test void rejectsAggregateOverflowWithoutLosingEarlierPayment() throws Exception {
        UUID shift = id(open(1));
        pay(shift, "MAX", 8999999999999L, "CASH");
        assertEquals(400, post(ROOT + "/shifts/" + shift + "/payments", reception, UUID.randomUUID(), payment("OVER", 1, "CARD")).statusCode());
        assertEquals(9000000000000L, ok(get(ROOT + "/shifts/" + shift, admin), 200).get("expectedCashCents").asLong());
        assertEquals(1, count("cash_payment"));
    }
    @Test void paymentReferencesRemainUniqueAcrossClosedShiftsAndCommandsCannotChangeActorOrPayload() throws Exception {
        UUID shift = id(open(0));
        UUID key = UUID.randomUUID();
        var input = payment("PAY-UNIQUE", 101, "CASH");
        var first = ok(post(ROOT + "/shifts/" + shift + "/payments", reception, key, input), 201);
        assertEquals(first, ok(post(ROOT + "/shifts/" + shift + "/payments", reception, key, input), 201));
        assertEquals(409, post(ROOT + "/shifts/" + shift + "/payments", reception, key, payment("PAY-UNIQUE", 102, "CASH")).statusCode());
        assertEquals(409, post(ROOT + "/shifts/" + shift + "/payments", admin, key, input).statusCode());
        close(shift, 101);
        UUID second = id(ok(post(ROOT + "/shifts", reception, UUID.randomUUID(), opening("SHIFT-02", 0)), 201));
        assertEquals(409, post(ROOT + "/shifts/" + second + "/payments", reception, UUID.randomUUID(), input).statusCode());
        assertEquals(1, count("cash_payment"));
    }
    @Test void reversalPreservesOriginalAndIsRecordedExactlyOnceWithReason() throws Exception {
        UUID shift = id(open(1000));
        var original = pay(shift, "PAY-01", 255, "CASH");
        var input = Map.of("reason", " Corrección sintética ");
        UUID key = UUID.randomUUID();
        String path = ROOT + "/payments/" + id(original) + "/reverse";
        var reversed = ok(post(path, admin, key, input), 200);
        assertTrue(reversed.get("reversed").asBoolean());
        assertEquals("Corrección sintética", reversed.get("reversalReason").asString());
        assertEquals(original.get("amountCents"), reversed.get("amountCents"));
        assertEquals(original.get("createdAt"), reversed.get("createdAt"));
        assertEquals(original.get("actor"), reversed.get("actor"));
        assertEquals("admin-cash", reversed.get("reversedBy").asString());
        assertEquals(reversed, ok(post(path, admin, key, input), 200));
        assertEquals(409, post(path, admin, UUID.randomUUID(), input).statusCode());
        assertEquals(1000L, ok(get(ROOT + "/shifts/" + shift, reception), 200).get("expectedCashCents").asLong());
        assertEquals(255L, jdbc.queryForObject("SELECT amount_cents FROM cash_payment WHERE id = ?", Long.class, id(original)));
        assertEquals(1, count("cash_payment")); assertEquals(1, count("cash_reversal"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE command_id = ? AND action = 'CASH_PAYMENT_REVERSED'", Integer.class, key));
    }
    @Test void closingPersistsDifferenceAndRejectsAllSubsequentMutationsButAllowsReplay() throws Exception {
        UUID shift = id(open(1000));
        var cash = pay(shift, "PAY-CASH", 255, "CASH");
        pay(shift, "PAY-CARD", 777, "CARD");
        UUID key = UUID.randomUUID();
        var input = Map.of("countedCashCents", 1200, "reason", "Diferencia sintética revisada");
        String path = ROOT + "/shifts/" + shift + "/close";
        var closed = ok(post(path, reception, key, input), 200);
        assertEquals("CLOSED", closed.get("status").asString());
        assertEquals(1255L, closed.get("expectedCashCents").asLong());
        assertEquals(-55L, closed.get("differenceCents").asLong());
        assertEquals(777L, closed.get("cardTotalCents").asLong());
        assertEquals(closed, ok(post(path, reception, key, input), 200));
        assertEquals(closed, ok(get(ROOT + "/shifts/" + shift, auditor), 200));
        assertEquals(409, post(path, reception, UUID.randomUUID(), input).statusCode());
        assertEquals(409, post(ROOT + "/shifts/" + shift + "/payments", reception, UUID.randomUUID(), payment("AFTER", 10, "CASH")).statusCode());
        assertEquals(409, post(ROOT + "/payments/" + id(cash) + "/reverse", admin, UUID.randomUUID(), Map.of("reason", "Intento posterior")).statusCode());
        assertEquals(0, count("cash_reversal"));
    }
    @Test void ledgersAndClosedShiftAreImmutableInDatabase() throws Exception {
        UUID shift = id(open(1000));
        var payment = pay(shift, "PAY-01", 200, "CASH");
        ok(post(ROOT + "/payments/" + id(payment) + "/reverse", admin, UUID.randomUUID(), Map.of("reason", "Corrección ficticia")), 200);
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("UPDATE cash_shift SET opening_float_cents = 7"));
        close(shift, 1000);
        for (String sql : List.of("DELETE FROM cash_payment", "UPDATE cash_payment SET amount_cents = 7", "DELETE FROM cash_reversal",
                "UPDATE cash_reversal SET reason = 'changed'", "DELETE FROM cash_shift", "UPDATE cash_shift SET counted_cash_cents = 7", "UPDATE cash_shift SET closed_at = null")) {
            assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update(sql), sql);
        }
        assertEquals(1, count("cash_payment")); assertEquals(1, count("cash_reversal")); assertEquals(1, count("cash_shift"));
    }
    @Test void readsAreBoundedAndMissingRecordsReported() throws Exception {
        UUID shift = id(open(0));
        assertEquals(400, get(ROOT + "/shifts?limit=101", admin).statusCode());
        assertEquals(400, get(ROOT + "/shifts?offset=-1", admin).statusCode());
        assertEquals(400, get(ROOT + "/shifts/" + shift + "/payments?limit=0", admin).statusCode());
        assertEquals(404, get(ROOT + "/shifts/" + UUID.randomUUID(), admin).statusCode());
        assertEquals(404, get(ROOT + "/shifts/" + UUID.randomUUID() + "/payments", admin).statusCode());
        assertEquals(404, post(ROOT + "/payments/" + UUID.randomUUID() + "/reverse", admin, UUID.randomUUID(), Map.of("reason", "Inexistente")).statusCode());
        assertEquals(404, post(ROOT + "/shifts/" + UUID.randomUUID() + "/payments", reception, UUID.randomUUID(), payment("MISSING", 1, "CASH")).statusCode());
    }
    @Test void concurrentOpenAllowsOnlyOneRegister() throws Exception {
        var responses = together(() -> post(ROOT + "/shifts", reception, UUID.randomUUID(), opening("OPEN-A", 10)),
            () -> post(ROOT + "/shifts", reception, UUID.randomUUID(), opening("OPEN-B", 20)));
        assertEquals(List.of(201, 409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, count("cash_shift"));
    }
    @Test void concurrentRetryHasOnePaymentAndOneAuditEffect() throws Exception {
        UUID shift = id(open(0)), key = UUID.randomUUID();
        String path = ROOT + "/shifts/" + shift + "/payments";
        var input = payment("RETRY", 12345, "CASH");
        var responses = together(() -> post(path, reception, key, input), () -> post(path, reception, key, input));
        assertEquals(ok(responses.get(0), 201), ok(responses.get(1), 201));
        assertEquals(1, count("cash_payment"));
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM audit_event WHERE command_id = ?", Integer.class, key));
    }
    @Test void concurrentReversalsAffectPaymentOnlyOnce() throws Exception {
        UUID shift = id(open(0));
        var payment = pay(shift, "PAY", 123, "CASH");
        String path = ROOT + "/payments/" + id(payment) + "/reverse";
        var input = Map.of("reason", "Reverso simultáneo ficticio");
        var responses = together(() -> post(path, admin, UUID.randomUUID(), input), () -> post(path, admin, UUID.randomUUID(), input));
        assertEquals(List.of(200, 409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, count("cash_reversal"));
        assertEquals(0L, ok(get(ROOT + "/shifts/" + shift, auditor), 200).get("cashTotalCents").asLong());
    }
    @Test void concurrentPaymentAndCloseHaveConsistentFrozenBalance() throws Exception {
        UUID shift = id(open(1000));
        var responses = together(() -> post(ROOT + "/shifts/" + shift + "/payments", reception, UUID.randomUUID(), payment("CONCURRENT", 321, "CASH")),
            () -> post(ROOT + "/shifts/" + shift + "/close", reception, UUID.randomUUID(), Map.of("countedCashCents", 1000, "reason", "Cierre simultáneo ficticio")));
        var closed = ok(responses.get(1), 200);
        assertTrue(List.of(201, 409).contains(responses.get(0).statusCode()), responses.get(0).body());
        long charged = responses.get(0).statusCode() == 201 ? 321 : 0;
        assertEquals(1000 + charged, closed.get("expectedCashCents").asLong());
        assertEquals(-charged, closed.get("differenceCents").asLong());
        assertEquals(closed, ok(get(ROOT + "/shifts/" + shift, auditor), 200));
    }
    @Test void concurrentReversalAndCloseCannotChangeAClosedBalance() throws Exception {
        UUID shift = id(open(1000));
        var payment = pay(shift, "CONCURRENT", 500, "CASH");
        var responses = together(() -> post(ROOT + "/payments/" + id(payment) + "/reverse", admin, UUID.randomUUID(), Map.of("reason", "Reverso simultáneo ficticio")),
            () -> post(ROOT + "/shifts/" + shift + "/close", reception, UUID.randomUUID(), Map.of("countedCashCents", 1000, "reason", "Cierre simultáneo ficticio")));
        var closed = ok(responses.get(1), 200);
        assertTrue(List.of(200, 409).contains(responses.get(0).statusCode()), responses.get(0).body());
        long retained = responses.get(0).statusCode() == 200 ? 0 : 500;
        assertEquals(1000 + retained, closed.get("expectedCashCents").asLong());
        assertEquals(closed, ok(get(ROOT + "/shifts/" + shift, auditor), 200));
        assertEquals(1, count("cash_payment"));
    }

    Map<String,Object> opening(String reference, long cents) { return Map.of("reference", reference, "openingFloatCents", cents); }
    Map<String,Object> payment(String reference, long cents, String method) { return Map.of("reference", reference, "amountCents", cents, "method", method); }
    JsonNode open(long cents) throws Exception { return ok(post(ROOT + "/shifts", reception, UUID.randomUUID(), opening("SHIFT-DEMO", cents)), 201); }
    JsonNode pay(UUID shift, String ref, long cents, String method) throws Exception { return ok(post(ROOT + "/shifts/" + shift + "/payments", reception, UUID.randomUUID(), payment(ref, cents, method)), 201); }
    JsonNode close(UUID shift, long cents) throws Exception { return ok(post(ROOT + "/shifts/" + shift + "/close", reception, UUID.randomUUID(), Map.of("countedCashCents", cents, "reason", "Cierre ficticio conciliado")), 200); }
    static UUID id(JsonNode node) { return UUID.fromString(node.get("id").asString()); }
    int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
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
        var r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(java.time.Duration.ofSeconds(20));
        if (token != null) r.header("Authorization", "Bearer " + token);
        if (key != null) r.header("Idempotency-Key", key.toString());
        if (body != null) r.header("Content-Type", "application/json");
        r.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        return client.send(r.build(), HttpResponse.BodyHandlers.ofString());
    }
}
