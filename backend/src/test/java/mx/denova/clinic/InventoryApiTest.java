package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
class InventoryApiTest {
    static final JwtFixture identity = new JwtFixture();
    static final HttpClient client = HttpClient.newHttpClient();
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    String admin;
    String pharmacy;
    static final String ROOT = "/api/v1/inventory";
    @DynamicPropertySource static void configure(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> env("TEST_DB_URL", "jdbc:postgresql://127.0.0.1:5432/clinic_test"));
        registry.add("spring.datasource.username", () -> env("TEST_DB_USER", "clinic_test"));
        registry.add("spring.datasource.password", () -> env("TEST_DB_PASSWORD", "synthetic-ci-only"));
        registry.add("spring.flyway.user", () -> env("TEST_DB_USER", "clinic_test"));
        registry.add("spring.flyway.password", () -> env("TEST_DB_PASSWORD", "synthetic-ci-only"));
        registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> identity.issuer);
        registry.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri", identity::uri);
    }
    static String env(String key, String fallback) { return System.getenv().getOrDefault(key, fallback); }
    @BeforeEach void before() {
        jdbc.execute("TRUNCATE purchase_receipt, purchase_line, purchase_order, purchase_supplier, inventory_movement, audit_event, inventory_command, inventory_lot, inventory_product RESTART IDENTITY CASCADE");
        admin = identity.token("admin-test", "ADMIN");
        pharmacy = identity.token("pharmacy-test", "FARMACIA");
    }
    @AfterAll static void stopIdentity() { identity.close(); }

    @Test void anonymousAndReceptionCannotReadStock() throws Exception {
        assertEquals(200, get("/health", null).statusCode());
        assertEquals(401, get(ROOT + "/products", null).statusCode());
        assertEquals(403, get(ROOT + "/products", identity.token("reception-test", "RECEPCION")).statusCode());
        assertEquals(403, get(ROOT + "/products", identity.token("unknown-test", "OWNER")).statusCode());
    }
    @Test void validatesSignatureIssuerAudienceAndExpiry() throws Exception {
        for (var token : List.of("forged.jwt.value",
                identity.token("a", "ADMIN", "https://other.example.test", "clinic-api", Instant.now().plusSeconds(60)),
                identity.token("a", "ADMIN", identity.issuer, "other-api", Instant.now().plusSeconds(60)),
                identity.token("a", "ADMIN", identity.issuer, "clinic-api", null),
                identity.token("", "ADMIN", identity.issuer, "clinic-api", Instant.now().plusSeconds(60)),
                identity.token("a", "ADMIN", identity.issuer, "clinic-api", Instant.now().minusSeconds(300))))
            assertEquals(401, get(ROOT + "/products", token).statusCode());
        try (var otherIdentity = new JwtFixture()) {
            assertEquals(401, get(ROOT + "/products", otherIdentity.token("a", "ADMIN")).statusCode());
        }
    }
    @Test void pharmacyCanReadButCannotCreateCatalogOrReadAudit() throws Exception {
        assertEquals(200, get(ROOT + "/products", pharmacy).statusCode());
        assertEquals(403, post(ROOT + "/products", pharmacy, UUID.randomUUID(), productBody("DEMO-01")).statusCode());
        assertEquals(403, get("/api/v1/audit/events", pharmacy).statusCode());
    }
    @Test void auditorReadsButCannotWriteOrUseUnimplementedRoutes() throws Exception {
        String auditor = identity.token("audit-test", "AUDITOR");
        assertEquals(200, get("/api/v1/audit/events", auditor).statusCode());
        assertEquals(403, post(ROOT + "/products", auditor, UUID.randomUUID(), productBody("DEMO-01")).statusCode());
        assertEquals(403, get("/api/v1/patients", admin).statusCode());
    }
    @Test void createsCatalogAndEmptyLotThenReceivesAndIssuesWithActorAudit() throws Exception {
        UUID lot = lot(false);
        var received = move(lot, "RECEIPT", 8, pharmacy, UUID.randomUUID());
        assertEquals(201, received.statusCode(), received.body());
        assertEquals(8, body(received).get("balanceAfter").asInt());
        var issued = move(lot, "ISSUE", 3, pharmacy, UUID.randomUUID());
        assertEquals(201, issued.statusCode());
        assertEquals(5, stock(lot));
        assertEquals("pharmacy-test", body(issued).get("actor").asString());
        var history = body(get(ROOT + "/movements?lotId=" + lot, admin)).get("items");
        assertEquals(2, history.size());
        assertEquals(4, body(get("/api/v1/audit/events", admin)).get("items").size());
    }
    @Test void rejectsDuplicateSkuAndLotWithoutPartialData() throws Exception {
        UUID product = product();
        assertEquals(409, post(ROOT + "/products", admin, UUID.randomUUID(), productBody("DEMO-01")).statusCode());
        var input = lotBody(product, false);
        assertEquals(201, post(ROOT + "/lots", pharmacy, UUID.randomUUID(), input).statusCode());
        assertEquals(409, post(ROOT + "/lots", pharmacy, UUID.randomUUID(), input).statusCode());
        assertEquals(2, count("inventory_command"));
        assertEquals(2, count("audit_event"));
    }
    @Test void pharmacyExpiryIsRequiredAndSupplyCanBeNonPerishable() throws Exception {
        UUID product = product();
        assertEquals(400, post(ROOT + "/lots", pharmacy, UUID.randomUUID(), Map.of("productId", product, "batch", "A", "quarantined", false)).statusCode());
        var supply = post(ROOT + "/products", admin, UUID.randomUUID(), Map.of("sku", "INS-01", "name", "Insumo ficticio", "category", "INSUMOS", "unit", "pieza", "minimumStock", 2));
        assertEquals(201, supply.statusCode());
        var nonPerishable = post(ROOT + "/lots", pharmacy, UUID.randomUUID(), Map.of("productId", body(supply).get("id").asString(), "batch", "A", "quarantined", false));
        assertEquals(201, nonPerishable.statusCode(), nonPerishable.body());
        assertTrue(body(nonPerishable).get("expiresOn").isNull());
    }
    @Test void rejectsInvalidAndFractionalQuantitiesUnknownFieldsAndMissingKeys() throws Exception {
        UUID lot = lot(false);
        for (int amount : new int[]{0, -1, 1000001}) assertEquals(400, move(lot, "RECEIPT", amount, pharmacy, UUID.randomUUID()).statusCode());
        assertEquals(400, post(ROOT + "/lots/" + lot + "/movements", pharmacy, UUID.randomUUID(), Map.of("kind", "RECEIPT", "quantity", 1.5, "reason", "Test")).statusCode());
        assertEquals(400, post(ROOT + "/lots/" + lot + "/movements", pharmacy, UUID.randomUUID(), Map.of("kind", "RECEIPT", "quantity", 1, "reason", "Test", "actor", "someone-else")).statusCode());
        assertEquals(400, post(ROOT + "/lots/" + lot + "/movements", pharmacy, UUID.randomUUID(), Map.of("kind", "RECEIPT", "quantity", 1, "reason", "  ")).statusCode());
        assertEquals(400, post(ROOT + "/lots/" + lot + "/movements", pharmacy, null, Map.of("kind", "RECEIPT", "quantity", 1, "reason", "Test")).statusCode());
        assertEquals(0, stock(lot));
        assertEquals(0, count("inventory_movement"));
    }
    @Test void retriesReturnOriginalResultWithoutDuplicatingStockOrAudit() throws Exception {
        UUID lot = lot(false), key = UUID.randomUUID();
        var first = move(lot, "RECEIPT", 5, pharmacy, key);
        move(lot, "ISSUE", 1, pharmacy, UUID.randomUUID());
        var repeated = move(lot, "RECEIPT", 5, pharmacy, key);
        assertEquals(201, repeated.statusCode());
        assertEquals(body(first), body(repeated));
        assertEquals(4, stock(lot));
        assertEquals(2, count("inventory_movement"));
        assertEquals(4, count("audit_event"));
    }
    @Test void sameKeyWithDifferentDataUserOrOperationIsConflict() throws Exception {
        UUID lot = lot(false), key = UUID.randomUUID();
        move(lot, "RECEIPT", 5, pharmacy, key);
        for (var response : List.of(move(lot, "RECEIPT", 6, pharmacy, key), move(lot, "RECEIPT", 5, admin, key), move(lot, "ISSUE", 5, pharmacy, key))) {
            assertEquals(409, response.statusCode());
            assertEquals("IDEMPOTENCY_CONFLICT", body(response).get("code").asString());
        }
        assertEquals(5, stock(lot));
    }
    @Test void failedMovementRollsBackKeyAndAllRelatedRecords() throws Exception {
        UUID lot = lot(false), key = UUID.randomUUID();
        assertEquals(409, move(lot, "ISSUE", 1, pharmacy, key).statusCode());
        assertEquals(2, count("inventory_command"));
        assertEquals(2, count("audit_event"));
        assertEquals(0, count("inventory_movement"));
        move(lot, "RECEIPT", 2, pharmacy, UUID.randomUUID());
        assertEquals(201, move(lot, "ISSUE", 1, pharmacy, key).statusCode());
        assertEquals(1, stock(lot));
    }
    @Test void concurrentLastUnitIsIssuedExactlyOnce() throws Exception {
        UUID lot = lot(false);
        move(lot, "RECEIPT", 1, pharmacy, UUID.randomUUID());
        var start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var a = workers.submit(() -> { start.await(); return move(lot, "ISSUE", 1, pharmacy, UUID.randomUUID()).statusCode(); });
            var b = workers.submit(() -> { start.await(); return move(lot, "ISSUE", 1, admin, UUID.randomUUID()).statusCode(); });
            start.countDown();
            assertEquals(List.of(201, 409), java.util.stream.Stream.of(a.get(), b.get()).sorted().toList());
        }
        assertEquals(0, stock(lot));
        assertEquals(2, count("inventory_movement"));
    }
    @Test void concurrentSameKeyCreatesOnlyOneReceipt() throws Exception {
        UUID lot = lot(false), key = UUID.randomUUID();
        var start = new CountDownLatch(1);
        try (var workers = Executors.newFixedThreadPool(2)) {
            var a = workers.submit(() -> { start.await(); return move(lot, "RECEIPT", 7, pharmacy, key); });
            var b = workers.submit(() -> { start.await(); return move(lot, "RECEIPT", 7, pharmacy, key); });
            start.countDown();
            var first = a.get(); var second = b.get();
            assertEquals(201, first.statusCode()); assertEquals(201, second.statusCode());
            assertEquals(body(first), body(second));
        }
        assertEquals(7, stock(lot));
        assertEquals(1, count("inventory_movement"));
    }
    @Test void quarantineNeedsAdminAndReceiptsNeverReleaseIt() throws Exception {
        UUID lot = lot(true);
        move(lot, "RECEIPT", 3, pharmacy, UUID.randomUUID());
        assertEquals(409, move(lot, "ISSUE", 1, pharmacy, UUID.randomUUID()).statusCode());
        var input = Map.of("quarantined", false, "reason", "Revisión ficticia completada");
        assertEquals(403, post(ROOT + "/lots/" + lot + "/quarantine", pharmacy, UUID.randomUUID(), input).statusCode());
        assertEquals(400, post(ROOT + "/lots/" + lot + "/quarantine", admin, UUID.randomUUID(), Map.of("reason", "Falta condición explícita")).statusCode());
        assertEquals(200, post(ROOT + "/lots/" + lot + "/quarantine", admin, UUID.randomUUID(), input).statusCode());
        assertEquals(201, move(lot, "ISSUE", 1, pharmacy, UUID.randomUUID()).statusCode());
        assertEquals(2, stock(lot));
    }
    @Test void expiredLotBlocksReceiptIssueAndReleaseButAllowsAdminDisposal() throws Exception {
        UUID lot = lot(false);
        move(lot, "RECEIPT", 3, pharmacy, UUID.randomUUID());
        jdbc.update("UPDATE inventory_lot SET expires_on = ?, quarantined = true WHERE id = ?", today().minusDays(1), lot);
        assertEquals(409, move(lot, "ISSUE", 1, pharmacy, UUID.randomUUID()).statusCode());
        assertEquals(409, move(lot, "RECEIPT", 1, pharmacy, UUID.randomUUID()).statusCode());
        assertEquals(409, post(ROOT + "/lots/" + lot + "/quarantine", admin, UUID.randomUUID(), Map.of("quarantined", false, "reason", "Test")).statusCode());
        assertEquals(403, move(lot, "DISPOSAL", 3, pharmacy, UUID.randomUUID()).statusCode());
        assertEquals(201, move(lot, "DISPOSAL", 3, admin, UUID.randomUUID()).statusCode());
        assertEquals(0, stock(lot));
    }
    @Test void fefoExcludesBlockedEmptyAndExpiredLots() throws Exception {
        UUID product = product();
        for (int day : new int[]{20, 5, 10, 30, 40}) {
            var response = post(ROOT + "/lots", pharmacy, UUID.randomUUID(), Map.of("productId", product, "batch", "FEFO-" + day, "expiresOn", today().plusDays(day).toString(), "quarantined", day == 5));
            UUID lot = UUID.fromString(body(response).get("id").asString());
            if (day != 30) move(lot, "RECEIPT", 1, pharmacy, UUID.randomUUID());
            if (day == 40) jdbc.update("UPDATE inventory_lot SET expires_on = ? WHERE id = ?", today().minusDays(1), lot);
        }
        var lots = body(get(ROOT + "/lots?productId=" + product + "&availableOnly=true", pharmacy)).get("items");
        assertEquals(2, lots.size());
        assertEquals("FEFO-10", lots.get(0).get("batch").asString());
        assertEquals("FEFO-20", lots.get(1).get("batch").asString());
    }
    @Test void databaseHistoryRejectsEditsAndDeletions() throws Exception {
        UUID lot = lot(false);
        move(lot, "RECEIPT", 1, pharmacy, UUID.randomUUID());
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("UPDATE inventory_movement SET reason = 'Changed'"));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("DELETE FROM audit_event"));
        assertEquals(1, count("inventory_movement"));
        assertEquals(3, count("audit_event"));
    }
    @Test void paginationAndMissingResourcesAreBounded() throws Exception {
        assertEquals(400, get(ROOT + "/lots?limit=10001", admin).statusCode());
        assertEquals(400, get(ROOT + "/movements?offset=-1", admin).statusCode());
        assertEquals(404, get(ROOT + "/lots/" + UUID.randomUUID(), admin).statusCode());
        assertEquals(400, get(ROOT + "/lots/not-a-uuid", admin).statusCode());
    }

    UUID product() throws Exception {
        var response = post(ROOT + "/products", admin, UUID.randomUUID(), productBody("DEMO-01"));
        assertEquals(201, response.statusCode(), response.body());
        return UUID.fromString(body(response).get("id").asString());
    }
    UUID lot(boolean quarantine) throws Exception {
        var response = post(ROOT + "/lots", pharmacy, UUID.randomUUID(), lotBody(product(), quarantine));
        assertEquals(201, response.statusCode(), response.body());
        assertEquals(0, body(response).get("quantity").asInt());
        return UUID.fromString(body(response).get("id").asString());
    }
    Map<String, Object> productBody(String sku) { return Map.of("sku", sku, "name", "Producto ficticio", "category", "FARMACIA", "unit", "pieza", "minimumStock", 3); }
    Map<String, Object> lotBody(UUID product, boolean quarantine) { return Map.of("productId", product, "batch", "LOTE-DEMO", "expiresOn", today().plusMonths(12).toString(), "quarantined", quarantine); }
    static LocalDate today() { return LocalDate.now(ZoneId.of("America/Mexico_City")); }
    HttpResponse<String> move(UUID lot, String kind, int amount, String token, UUID key) throws Exception { return post(ROOT + "/lots/" + lot + "/movements", token, key, Map.of("kind", kind, "quantity", amount, "reason", "Operación ficticia")); }
    int stock(UUID id) throws Exception { return body(get(ROOT + "/lots/" + id, admin)).get("quantity").asInt(); }
    int count(String table) { return jdbc.queryForObject("SELECT count(*) FROM " + table, Integer.class); }
    JsonNode body(HttpResponse<String> response) { return json.readTree(response.body()); }
    HttpResponse<String> get(String path, String token) throws Exception { return request("GET", path, token, null, null); }
    HttpResponse<String> post(String path, String token, UUID key, Object body) throws Exception { return request("POST", path, token, key, body); }
    HttpResponse<String> request(String method, String path, String token, UUID key, Object body) throws Exception {
        var request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(java.time.Duration.ofSeconds(20));
        if (token != null) request.header("Authorization", "Bearer " + token);
        if (key != null) request.header("Idempotency-Key", key.toString());
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(json.writeValueAsString(body)));
        if (body != null) request.header("Content-Type", "application/json");
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
