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
class PurchasingApiTest {
    static final JwtFixture identity = new JwtFixture();
    static final HttpClient client = HttpClient.newHttpClient();
    static final String ROOT = "/api/v1/purchasing";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
    String admin, pharmacy;
    UUID supplier, product;
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
    @BeforeEach void before() throws Exception {
        jdbc.execute("TRUNCATE purchase_receipt, purchase_line, purchase_order, purchase_supplier, inventory_movement, audit_event, inventory_command, inventory_lot, inventory_product RESTART IDENTITY CASCADE");
        admin = identity.token("admin-purchasing", "ADMIN");
        pharmacy = identity.token("pharmacy-purchasing", "FARMACIA");
        supplier = id(ok(post(ROOT + "/suppliers", admin, UUID.randomUUID(), Map.of("reference", "SUP-DEMO", "name", "Proveedor ficticio")), 201));
        product = createProduct("MED-DEMO", "FARMACIA");
    }
    @AfterAll static void stopIdentity() { identity.close(); }

    @Test void enforcesPurchasingRolesAndDoesNotOpenOtherMethods() throws Exception {
        assertEquals(401, get(ROOT + "/orders", null).statusCode());
        assertEquals(403, get(ROOT + "/suppliers", identity.token("reception", "RECEPCION")).statusCode());
        assertEquals(403, post(ROOT + "/suppliers", pharmacy, UUID.randomUUID(), Map.of("reference", "SUP-OTHER", "name", "Otro ficticio")).statusCode());
        var auditor = identity.token("audit", "AUDITOR");
        assertEquals(200, get(ROOT + "/orders", auditor).statusCode());
        assertEquals(403, post(ROOT + "/orders", auditor, UUID.randomUUID(), orderInput("OC-AUDIT", List.of(line(product, 2, 100)))).statusCode());
        assertEquals(403, request("DELETE", ROOT + "/orders/" + UUID.randomUUID(), admin, null, null).statusCode());
    }
    @Test void supplierReferencesAreNormalizedUniqueAndIdempotent() throws Exception {
        UUID key = UUID.randomUUID();
        var input = Map.of("reference", " prov-02 ", "name", "Proveedor dos ficticio");
        var first = ok(post(ROOT + "/suppliers", admin, key, input), 201);
        assertEquals("PROV-02", first.get("reference").asString());
        assertEquals(first, ok(post(ROOT + "/suppliers", admin, key, input), 201));
        assertEquals(409, post(ROOT + "/suppliers", admin, UUID.randomUUID(), input).statusCode());
        assertEquals(2, count("purchase_supplier"));
    }
    @Test void orderSnapshotsAreExactInCentsAndDoNotChangeStock() throws Exception {
        UUID supply = createProduct("INS-DEMO", "INSUMOS");
        var order = createOrder("OC-01", List.of(line(product, 5, 1234), line(supply, 3, 567)));
        assertEquals("PENDING", order.get("status").asString());
        assertEquals("MXN", order.get("currency").asString());
        assertEquals(7871L, order.get("totalCents").asLong());
        assertEquals(7871L, order.get("pendingCents").asLong());
        assertEquals(0, count("inventory_lot"));
        assertEquals(0, count("inventory_movement"));
        jdbc.update("UPDATE inventory_product SET name = 'Nombre actualizado' WHERE id = ?", product);
        var reloaded = ok(get(ROOT + "/orders/" + id(order), pharmacy), 200);
        assertEquals("Producto ficticio", reloaded.get("lines").get(0).get("productName").asString());
        assertEquals(1234L, reloaded.get("lines").get(0).get("unitCostCents").asLong());
    }
    @Test void rejectsDuplicateProductsInvalidAmountsAndMissingProductsWithoutPartialOrders() throws Exception {
        int commandsBefore = count("inventory_command"), auditBefore = count("audit_event");
        var invalidBodies = List.of(
            orderInput("OC-EMPTY", List.of()),
            orderInput("OC-DUP", List.of(line(product, 1, 100), line(product, 2, 100))),
            orderInput("OC-ZERO", List.of(line(product, 0, 100))),
            orderInput("OC-COST", List.of(line(product, 1, 0))),
            orderInput("OC-LARGE", List.of(line(product, 1000000, 100000000))));
        for (var input : invalidBodies) assertEquals(400, post(ROOT + "/orders", pharmacy, UUID.randomUUID(), input).statusCode());
        assertEquals(404, post(ROOT + "/orders", pharmacy, UUID.randomUUID(), orderInput("OC-MISSING", List.of(line(product, 1, 100), line(UUID.randomUUID(), 1, 100)))).statusCode());
        assertEquals(0, count("purchase_order"));
        assertEquals(0, count("purchase_line"));
        assertEquals(commandsBefore, count("inventory_command"));
        assertEquals(auditBefore, count("audit_event"));
    }
    @Test void rejectsPastDatesFractionsAndDuplicateOrderReferences() throws Exception {
        var past = new HashMap<>(orderInput("OC-PAST", List.of(line(product, 1, 100))));
        past.put("expectedOn", today().minusDays(1).toString());
        assertEquals(400, post(ROOT + "/orders", pharmacy, UUID.randomUUID(), past).statusCode());
        var fractional = orderInput("OC-FLOAT", List.of(Map.of("productId", product, "quantity", 1, "unitCostCents", 10.5)));
        assertEquals(400, post(ROOT + "/orders", pharmacy, UUID.randomUUID(), fractional).statusCode());
        UUID key = UUID.randomUUID();
        var input = orderInput("OC-01", List.of(line(product, 2, 100)));
        var first = ok(post(ROOT + "/orders", pharmacy, key, input), 201);
        assertEquals(first, ok(post(ROOT + "/orders", pharmacy, key, input), 201));
        assertEquals(409, post(ROOT + "/orders", pharmacy, UUID.randomUUID(), input).statusCode());
        assertEquals(1, count("purchase_order"));
    }
    @Test void partialDeliveriesUpdateLinesLotsHistoryAndSummariesTogether() throws Exception {
        UUID supply = createProduct("INS-DEMO", "INSUMOS");
        var order = createOrder("OC-01", List.of(line(product, 5, 1234), line(supply, 3, 567)));
        UUID orderId = id(order), firstLine = lineId(order, 0), secondLine = lineId(order, 1);
        var first = ok(receive(orderId, firstLine, "REC-01", 2, "LOTE-A", false, UUID.randomUUID()), 201);
        assertEquals("pharmacy-purchasing", first.get("actor").asString());
        assertEquals(1234L, first.get("unitCostCents").asLong());
        var partial = ok(get(ROOT + "/orders/" + orderId, pharmacy), 200);
        assertEquals("PARTIAL", partial.get("status").asString());
        assertEquals(2468L, partial.get("receivedCents").asLong());
        assertEquals(5403L, partial.get("pendingCents").asLong());
        ok(receive(orderId, firstLine, "REC-02", 3, "LOTE-A", false, UUID.randomUUID()), 201);
        ok(receive(orderId, secondLine, "REC-03", 3, "LOTE-A", false, UUID.randomUUID()), 201);
        var complete = ok(get(ROOT + "/orders/" + orderId, pharmacy), 200);
        assertEquals("RECEIVED", complete.get("status").asString());
        assertEquals(7871L, complete.get("receivedCents").asLong());
        assertEquals(0L, complete.get("pendingCents").asLong());
        assertEquals(5, stock(UUID.fromString(first.get("lotId").asString())));
        assertEquals(2, count("inventory_lot"));
        assertEquals(3, count("inventory_movement"));
        var receipts = ok(get(ROOT + "/receipts?orderId=" + orderId + "&lotId=" + first.get("lotId").asString(), pharmacy), 200);
        assertEquals(2, receipts.get("items").size());
        var summary = ok(get(ROOT + "/orders?supplierId=" + supplier, pharmacy), 200).get("items").get(0);
        assertEquals("RECEIVED", summary.get("status").asString());
        assertEquals(7871L, summary.get("receivedCents").asLong());
    }
    @Test void overReceiptAndForeignLinesDoNotCreateStockOrEvents() throws Exception {
        var order = order(2);
        var another = createOrder("OC-02", List.of(line(product, 1, 100)));
        int commands = count("inventory_command"), events = count("audit_event");
        assertEquals(409, receive(id(order), lineId(order,0), "REC-OVER", 3, "LOTE-A", false, UUID.randomUUID()).statusCode());
        assertEquals(404, receive(id(order), lineId(another,0), "REC-WRONG", 1, "LOTE-A", false, UUID.randomUUID()).statusCode());
        assertEquals(0, count("inventory_lot")); assertEquals(0, count("purchase_receipt"));
        assertEquals(commands, count("inventory_command")); assertEquals(events, count("audit_event"));
    }
    @Test void receiptRetryRemainsStableAfterOrderCompletion() throws Exception {
        var order = order(5); UUID key = UUID.randomUUID();
        var first = ok(receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", false, key), 201);
        ok(receive(id(order), lineId(order,0), "REC-02", 3, "LOTE-A", false, UUID.randomUUID()), 201);
        assertEquals(first, ok(receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", false, key), 201));
        assertEquals(5, stock(UUID.fromString(first.get("lotId").asString())));
        assertEquals(2, count("purchase_receipt")); assertEquals(2, count("inventory_movement"));
    }
    @Test void duplicateReceiptReferenceRollsBackStockMovementAndCommand() throws Exception {
        var order = order(10);
        var first = ok(receive(id(order), lineId(order,0), "REC-01", 3, "LOTE-A", false, UUID.randomUUID()), 201);
        int commands = count("inventory_command"), events = count("audit_event");
        assertEquals(409, receive(id(order), lineId(order,0), "REC-01", 1, "LOTE-B", false, UUID.randomUUID()).statusCode());
        assertEquals(3, stock(UUID.fromString(first.get("lotId").asString())));
        assertEquals(1, count("inventory_lot")); assertEquals(1, count("inventory_movement"));
        assertEquals(1, count("purchase_receipt")); assertEquals(commands, count("inventory_command"));
        assertEquals(events, count("audit_event"));
    }
    @Test void idempotencyKeyCannotBeReusedForOtherDataActorOrOrder() throws Exception {
        var order = order(10); UUID key = UUID.randomUUID();
        ok(receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", false, key), 201);
        var input = receiptInput(lineId(order,0), "REC-01", 2, "LOTE-A", false);
        assertEquals(409, receive(id(order), lineId(order,0), "REC-01", 3, "LOTE-A", false, key).statusCode());
        assertEquals(409, post(ROOT + "/orders/" + id(order) + "/receipts", admin, key, input).statusCode());
        assertEquals(409, post(ROOT + "/orders/" + UUID.randomUUID() + "/receipts", pharmacy, key, input).statusCode());
        assertEquals(1, count("purchase_receipt"));
    }
    @Test void existingLotConditionAndExpiryCannotBeOverwrittenByReceipt() throws Exception {
        var order = order(10);
        var existing = ok(post("/api/v1/inventory/lots", pharmacy, UUID.randomUUID(), Map.of("productId", product, "batch", "LOTE-A", "expiresOn", today().plusYears(1).toString(), "quarantined", true)), 201);
        assertEquals(409, receive(id(order), lineId(order,0), "REC-BAD", 1, "LOTE-A", false, UUID.randomUUID()).statusCode());
        var changedExpiry = new HashMap<>(receiptInput(lineId(order,0), "REC-BAD", 1, "LOTE-A", true));
        changedExpiry.put("expiresOn", today().plusYears(2).toString());
        assertEquals(409, post(ROOT + "/orders/" + id(order) + "/receipts", pharmacy, UUID.randomUUID(), changedExpiry).statusCode());
        assertEquals(0, stock(id(existing))); assertEquals(0, count("purchase_receipt"));
        ok(receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", true, UUID.randomUUID()), 201);
        assertEquals(409, post("/api/v1/inventory/lots/" + id(existing) + "/movements", pharmacy, UUID.randomUUID(), Map.of("kind", "ISSUE", "quantity", 1, "reason", "Prueba ficticia")).statusCode());
        assertTrue(ok(get("/api/v1/inventory/lots/" + id(existing), pharmacy), 200).get("quarantined").asBoolean());
    }
    @Test void expiryConditionAndReceiptCostAreValidatedBeforePersistence() throws Exception {
        var order = order(10);
        var input = new HashMap<>(receiptInput(lineId(order,0), "REC-01", 1, "LOTE-A", false));
        input.put("expiresOn", today().minusDays(1).toString());
        assertEquals(409, post(ROOT + "/orders/" + id(order) + "/receipts", pharmacy, UUID.randomUUID(), input).statusCode());
        input.remove("expiresOn");
        assertEquals(400, post(ROOT + "/orders/" + id(order) + "/receipts", pharmacy, UUID.randomUUID(), input).statusCode());
        input.put("expiresOn", today().plusYears(1).toString()); input.remove("quarantined");
        assertEquals(400, post(ROOT + "/orders/" + id(order) + "/receipts", pharmacy, UUID.randomUUID(), input).statusCode());
        input.put("quarantined", false); input.put("unitCostCents", 1);
        assertEquals(400, post(ROOT + "/orders/" + id(order) + "/receipts", pharmacy, UUID.randomUUID(), input).statusCode());
        assertEquals(0, count("inventory_lot")); assertEquals(0, count("inventory_movement"));
    }
    @Test void nonPerishableSupplyCanBeReceivedWithoutAnExpiry() throws Exception {
        UUID supply = createProduct("INS-DEMO", "INSUMOS");
        var order = createOrder("OC-01", List.of(line(supply, 1, 100)));
        var input = new HashMap<>(receiptInput(lineId(order,0), "REC-01", 1, "LOTE-A", false)); input.remove("expiresOn");
        var receipt = ok(post(ROOT + "/orders/" + id(order) + "/receipts", pharmacy, UUID.randomUUID(), input), 201);
        assertTrue(receipt.get("expiresOn").isNull());
        assertEquals(1, stock(UUID.fromString(receipt.get("lotId").asString())));
    }
    @Test void cancellationPreservesReceivedStockAndOnlyAdminCanCancel() throws Exception {
        var order = order(5); UUID key = UUID.randomUUID();
        var receipt = ok(receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", false, UUID.randomUUID()), 201);
        var input = Map.of("reason", "Saldo pendiente cancelado de ejemplo");
        String path = ROOT + "/orders/" + id(order) + "/cancel";
        assertEquals(403, post(path, pharmacy, key, input).statusCode());
        assertEquals(400, post(path, admin, key, Map.of("reason", "   ")).statusCode());
        var cancelled = ok(post(path, admin, key, input), 200);
        assertEquals("CANCELLED", cancelled.get("status").asString());
        assertEquals(0L, cancelled.get("pendingCents").asLong());
        assertEquals(2500L, cancelled.get("totalCents").asLong());
        assertEquals(1000L, cancelled.get("receivedCents").asLong());
        assertEquals(2, cancelled.get("lines").get(0).get("received").asInt());
        assertEquals(cancelled, ok(post(path, admin, key, input), 200));
        assertEquals(409, receive(id(order), lineId(order,0), "REC-02", 1, "LOTE-A", false, UUID.randomUUID()).statusCode());
        assertEquals(2, stock(UUID.fromString(receipt.get("lotId").asString())));
        assertEquals(1, count("purchase_receipt"));
    }
    @Test void completedOrderCannotBeCancelled() throws Exception {
        var order = order(1);
        ok(receive(id(order), lineId(order,0), "REC-01", 1, "LOTE-A", false, UUID.randomUUID()), 201);
        assertEquals(409, post(ROOT + "/orders/" + id(order) + "/cancel", admin, UUID.randomUUID(), Map.of("reason", "Prueba")).statusCode());
        assertEquals("RECEIVED", ok(get(ROOT + "/orders/" + id(order), pharmacy), 200).get("status").asString());
    }
    @Test void concurrentLastUnitIsReceivedOnlyOnce() throws Exception {
        var order = order(1);
        var responses = together(() -> receive(id(order), lineId(order,0), "REC-A", 1, "LOTE-A", false, UUID.randomUUID()),
                () -> receive(id(order), lineId(order,0), "REC-B", 1, "LOTE-A", false, UUID.randomUUID()));
        assertEquals(List.of(201,409), responses.stream().map(HttpResponse::statusCode).sorted().toList());
        assertEquals(1, count("purchase_receipt")); assertEquals(1, count("inventory_movement"));
        assertEquals(1, jdbc.queryForObject("SELECT sum(quantity) FROM inventory_lot", Integer.class));
    }
    @Test void concurrentRetryHasOneStockEffectAndOneReceipt() throws Exception {
        var order = order(5); UUID key = UUID.randomUUID();
        var responses = together(() -> receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", false, key),
                () -> receive(id(order), lineId(order,0), "REC-01", 2, "LOTE-A", false, key));
        assertEquals(ok(responses.get(0), 201), ok(responses.get(1), 201));
        assertEquals(1, count("purchase_receipt")); assertEquals(1, count("inventory_movement"));
        assertEquals(2, jdbc.queryForObject("SELECT sum(quantity) FROM inventory_lot", Integer.class));
    }
    @Test void concurrentDifferentOrdersShareOneManufacturerLot() throws Exception {
        var first = order(2);
        var second = createOrder("OC-02", List.of(line(product, 3, 500)));
        var responses = together(() -> receive(id(first), lineId(first,0), "REC-A", 2, "SHARED", false, UUID.randomUUID()),
                () -> receive(id(second), lineId(second,0), "REC-B", 3, "SHARED", false, UUID.randomUUID()));
        var a = ok(responses.get(0), 201);
        var b = ok(responses.get(1), 201);
        assertEquals(a.get("lotId"), b.get("lotId"));
        assertEquals(5, stock(UUID.fromString(a.get("lotId").asString())));
        assertEquals(1, count("inventory_lot")); assertEquals(2, count("inventory_movement"));
    }
    @Test void concurrentCancellationAndReceiptHaveAConsistentFinalState() throws Exception {
        var order = order(10);
        var responses = together(() -> post(ROOT + "/orders/" + id(order) + "/cancel", admin, UUID.randomUUID(), Map.of("reason", "Cancelación ficticia")),
                () -> receive(id(order), lineId(order,0), "REC-01", 3, "LOTE-A", false, UUID.randomUUID()));
        ok(responses.get(0), 200);
        assertTrue(List.of(201,409).contains(responses.get(1).statusCode()));
        int received = responses.get(1).statusCode() == 201 ? 3 : 0;
        var finalOrder = ok(get(ROOT + "/orders/" + id(order), pharmacy), 200);
        assertEquals("CANCELLED", finalOrder.get("status").asString());
        assertEquals(0L, finalOrder.get("pendingCents").asLong());
        assertEquals(received, finalOrder.get("lines").get(0).get("received").asInt());
        assertEquals(received, jdbc.queryForObject("SELECT coalesce(sum(quantity),0) FROM inventory_lot", Integer.class));
    }
    @Test void receiptHistoryIsProtectedAndReadsAreBounded() throws Exception {
        var order = order(1);
        ok(receive(id(order), lineId(order,0), "REC-01", 1, "LOTE-A", false, UUID.randomUUID()), 201);
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("UPDATE purchase_receipt SET unit_cost_cents = 1"));
        assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("DELETE FROM purchase_receipt"));
        assertEquals(400, get(ROOT + "/orders?limit=101", admin).statusCode());
        assertEquals(400, get(ROOT + "/receipts?offset=-1", admin).statusCode());
        assertEquals(404, get(ROOT + "/orders/" + UUID.randomUUID(), admin).statusCode());
        assertEquals(1, count("purchase_receipt"));
    }

    static LocalDate today() { return LocalDate.now(ZoneId.of("America/Mexico_City")); }
    static UUID id(JsonNode value) { return UUID.fromString(value.get("id").asString()); }
    static UUID lineId(JsonNode order, int position) { return id(order.get("lines").get(position)); }
    static Map<String,Object> line(UUID product, int quantity, long cost) { return Map.of("productId", product, "quantity", quantity, "unitCostCents", cost); }
    Map<String,Object> orderInput(String reference, List<? extends Map<String,?>> lines) { return Map.of("reference", reference, "supplierId", supplier, "expectedOn", today().plusDays(3).toString(), "lines", lines); }
    Map<String,Object> receiptInput(UUID line, String reference, int quantity, String batch, boolean quarantine) { return Map.of("reference", reference, "lineId", line, "quantity", quantity, "batch", batch, "expiresOn", today().plusYears(1).toString(), "quarantined", quarantine); }
    UUID createProduct(String sku, String category) throws Exception { return id(ok(post("/api/v1/inventory/products", admin, UUID.randomUUID(), Map.of("sku", sku, "name", "Producto ficticio", "category", category, "unit", "pieza", "minimumStock", 1)), 201)); }
    JsonNode createOrder(String ref, List<? extends Map<String,?>> lines) throws Exception { return ok(post(ROOT + "/orders", pharmacy, UUID.randomUUID(), orderInput(ref, lines)), 201); }
    JsonNode order(int quantity) throws Exception { return createOrder("OC-01", List.of(line(product, quantity, 500))); }
    HttpResponse<String> receive(UUID order, UUID line, String reference, int quantity, String batch, boolean quarantine, UUID key) throws Exception { return post(ROOT + "/orders/" + order + "/receipts", pharmacy, key, receiptInput(line, reference, quantity, batch, quarantine)); }
    int stock(UUID id) throws Exception { return ok(get("/api/v1/inventory/lots/" + id, pharmacy), 200).get("quantity").asInt(); }
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
