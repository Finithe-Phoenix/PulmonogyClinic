package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
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

// Read-API tests use fixtures in a disposable PostgreSQL database, never a production data source.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class InventoryPurchasingSearchApiTest {
    static final JwtFixture identity = new JwtFixture();
    static final HttpClient client = HttpClient.newHttpClient();
    static final String PRODUCTS = "/api/v1/inventory/products";
    static final String LOTS = "/api/v1/inventory/lots";
    static final String SUPPLIERS = "/api/v1/purchasing/suppliers";
    static final String ORDERS = "/api/v1/purchasing/orders";
    @Value("${local.server.port}") int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;
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
        jdbc.execute("TRUNCATE purchase_receipt, purchase_line, purchase_order, purchase_supplier, inventory_movement, audit_event, inventory_command, inventory_lot, inventory_product RESTART IDENTITY CASCADE");
        admin = identity.token("admin-search", "ADMIN");
    }
    @AfterAll static void stopIdentity() { identity.close(); }

    @Test void productsSearchesSkuNameAndCategoryBeforePagination() throws Exception {
        for (int i=0; i<55; i++) product("CAT-%03d".formatted(i), "Insumo de ejemplo " + i, "INSUMOS");
        UUID target = product("CAT-999", "Objetivo inhalador sintético", "FARMACIA");
        assertFirstPageExcludes(PRODUCTS, target);
        assertOnly(target, items(PRODUCTS + "?q=" + encode("  cAt-999  ")));
        assertOnly(target, items(PRODUCTS + "?q=inhalador"));
        assertOnly(target, items(PRODUCTS + "?q=farmacia"));
        assertOnly(target, items(PRODUCTS + "?q=cat&limit=1&offset=55"));
    }

    @Test void lotsSearchesBatchOrProductBeyondFirstPageAndPreservesAvailabilityFilters() throws Exception {
        UUID ordinary = product("BASE-01", "Suministro de ejemplo", "INSUMOS");
        for (int i=0; i<55; i++) lot(ordinary, "BASE-%03d".formatted(i), today().plusDays(i+1));
        UUID special = product("FINAL-99", "Accesorio exclusivo", "INSUMOS");
        UUID target = lot(special, "OBJETIVO-FINAL", null);
        assertFirstPageExcludes(LOTS, target);
        var matchingLots = items(LOTS + "?q=objetivo-final");
        assertOnly(target, matchingLots);
        assertEquals("Accesorio exclusivo", matchingLots.get(0).get("productName").asString());
        assertEquals("FINAL-99", matchingLots.get(0).get("productSku").asString());
        assertOnly(target, items(LOTS + "?q=final-99"));
        assertOnly(target, items(LOTS + "?q=exclusivo&availableOnly=true&productId=" + special));
        assertEquals(0, items(LOTS + "?q=exclusivo&productId=" + ordinary).size());
        jdbc.update("UPDATE inventory_lot SET quarantined = true WHERE id = ?", target);
        assertEquals(0, items(LOTS + "?q=exclusivo&availableOnly=true").size());
        assertOnly(target, items(LOTS + "?q=exclusivo&availableOnly=false"));
        jdbc.update("UPDATE inventory_lot SET quarantined = false, quantity = 0 WHERE id = ?", target);
        assertEquals(0, items(LOTS + "?q=exclusivo&availableOnly=true").size());
        jdbc.update("UPDATE inventory_lot SET quantity = 4, expires_on = ? WHERE id = ?", today().minusDays(1), target);
        assertEquals(0, items(LOTS + "?q=exclusivo&availableOnly=true").size());
    }

    @Test void suppliersSearchReferenceAndNameBeyondFirstPage() throws Exception {
        for (int i=0; i<55; i++) supplier("PROV-%03d".formatted(i), "Proveedor de ejemplo " + i);
        UUID target = supplier("PROV-999", "Distribuidor exclusivo sintético");
        assertFirstPageExcludes(SUPPLIERS, target);
        assertOnly(target, items(SUPPLIERS + "?q=prov-999"));
        assertOnly(target, items(SUPPLIERS + "?q=" + encode(" EXCLUSIVO ")));
        assertOnly(target, items(SUPPLIERS + "?q=prov&limit=1&offset=55"));
    }

    @Test void ordersSearchReferenceAndSupplierBeyondFirstPageWithoutChangingTotals() throws Exception {
        UUID product = product("PR-01", "Insumo de ejemplo", "INSUMOS");
        UUID supplier = supplier("SUP-BASE", "Proveedor de ejemplo");
        for (int i=0; i<55; i++) order("OC-%03d".formatted(i), supplier, product, i);
        UUID targetSupplier = supplier("SUP-FINAL", "Distribuidor exclusivo sintético");
        UUID target = order("OC-FINAL", targetSupplier, product, 100);
        UUID secondProduct = product("PR-02", "Segundo insumo de ejemplo", "INSUMOS");
        jdbc.update("UPDATE purchase_line SET received = 1 WHERE order_id = ?", target);
        jdbc.update("INSERT INTO purchase_line(id, order_id, product_id, position, sku, product_name, category, unit, ordered, unit_cost_cents) VALUES (?, ?, ?, 1, 'PR-02', 'Segundo insumo de ejemplo', 'INSUMOS', 'pieza', 3, 250)", UUID.randomUUID(), target, secondProduct);
        assertFirstPageExcludes(ORDERS, target);
        assertOnly(target, items(ORDERS + "?q=oc-final"));
        assertOnly(target, items(ORDERS + "?q=sup-final"));
        var matches = items(ORDERS + "?q=exclusivo&supplierId=" + targetSupplier);
        assertOnly(target, matches);
        var summary = matches.get(0);
        assertEquals(1000, summary.get("totalCents").asLong());
        assertEquals(125, summary.get("receivedCents").asLong());
        assertEquals(875, summary.get("pendingCents").asLong());
        assertEquals("PARTIAL", summary.get("status").asString());
        assertEquals(0, items(ORDERS + "?q=exclusivo&supplierId=" + supplier).size());
        assertOnly(target, items(ORDERS + "?q=oc&limit=1&offset=55"));
    }

    @Test void productsTreatPercentUnderscoreAndBackslashAsLiteralSearchText() throws Exception {
        UUID percent = product("LIT-01", "Modelo 50% sintético", "INSUMOS");
        UUID underscore = product("LIT-02", "Sensor_urbano sintético", "INSUMOS");
        UUID backslash = product("LIT-03", "Prueba\\separador", "INSUMOS");
        product("LIT-04", "Modelo sin símbolos", "INSUMOS");
        assertOnly(percent, items(PRODUCTS + "?q=" + encode("%")));
        assertOnly(underscore, items(PRODUCTS + "?q=" + encode("_")));
        assertOnly(backslash, items(PRODUCTS + "?q=" + encode("\\")));
    }

    @Test void lotsTreatPercentAndUnderscoreAsLiteralSearchText() throws Exception {
        UUID product = product("LIT-01", "Producto de ejemplo", "INSUMOS");
        UUID percent = lot(product, "BATCH%X", null);
        UUID underscore = lot(product, "BATCH_X", null);
        lot(product, "BATCHAX", null);
        assertOnly(percent, items(LOTS + "?q=" + encode("%")));
        assertOnly(underscore, items(LOTS + "?q=" + encode("_")));
    }

    @Test void suppliersTreatPercentAndUnderscoreAsLiteralSearchText() throws Exception {
        UUID percent = supplier("SUP-01", "Proveedor 50% sintético");
        UUID underscore = supplier("SUP_02", "Proveedor sintético");
        supplier("SUPA02", "Proveedor normal");
        assertOnly(percent, items(SUPPLIERS + "?q=" + encode("%")));
        assertOnly(underscore, items(SUPPLIERS + "?q=" + encode("_")));
    }

    @Test void ordersTreatPercentAndUnderscoreAsLiteralSearchText() throws Exception {
        UUID product = product("LIT-01", "Producto de ejemplo", "INSUMOS");
        UUID supplier = supplier("SUP-01", "Proveedor de ejemplo");
        UUID percent = order("OC%01", supplier, product, 0);
        UUID underscore = order("OC_02", supplier, product, 1);
        order("OCA02", supplier, product, 2);
        assertOnly(percent, items(ORDERS + "?q=" + encode("%")));
        assertOnly(underscore, items(ORDERS + "?q=" + encode("_")));
    }

    @Test void allSearchesAreBoundedAndEmptyQueriesPreserveExistingLists() throws Exception {
        UUID product = product("BASE-01", "Producto de ejemplo", "INSUMOS");
        UUID supplier = supplier("SUP-01", "Proveedor de ejemplo");
        lot(product, "BATCH-A", null); order("OC-01", supplier, product, 0);
        for (String path : List.of(PRODUCTS, LOTS, SUPPLIERS, ORDERS)) {
            var response = get(path + "?q=" + "x".repeat(161), admin);
            assertEquals("INVALID_SEARCH", ok(response, 400).get("code").asString());
            assertEquals(400, get(path + "?q=ejemplo&limit=101", admin).statusCode());
            assertEquals(400, get(path + "?q=ejemplo&offset=-1", admin).statusCode());
            assertEquals(items(path), items(path + "?q=" + encode("   ")));
            assertEquals(0, items(path + "?q=" + encode("' OR 1=1 --")).size());
            assertEquals(0, items(path + "?q=no-such-record").size());
        }
    }

    @Test void productDetailResolvesAnOffPageLotProductAndEnforcesReadRoles() throws Exception {
        for (int i=0; i<55; i++) product("CAT-%03d".formatted(i), "Insumo de ejemplo " + i, "INSUMOS");
        UUID product = product("CAT-999", "Detalle del producto sintético", "INSUMOS");
        UUID lot = lot(product, "RESOLVER-LOTE", null);
        assertFirstPageExcludes(PRODUCTS, product);
        var lotBody = ok(get(LOTS + "/" + lot, admin), 200);
        assertEquals("CAT-999", lotBody.get("productSku").asString());
        assertEquals("Detalle del producto sintético", lotBody.get("productName").asString());
        String detailPath = PRODUCTS + "/" + lotBody.get("productId").asString();
        for (String role : List.of("ADMIN", "FARMACIA", "AUDITOR")) {
            var detail = ok(get(detailPath, identity.token("reader-" + role, role)), 200);
            assertEquals(product.toString(), detail.get("id").asString());
            assertEquals("CAT-999", detail.get("sku").asString());
            assertEquals("Detalle del producto sintético", detail.get("name").asString());
            assertEquals("pieza", detail.get("unit").asString());
        }
        assertEquals(401, get(detailPath, null).statusCode());
        assertEquals(403, get(detailPath, identity.token("reception", "RECEPCION")).statusCode());
        assertEquals(404, get(PRODUCTS + "/" + UUID.randomUUID(), admin).statusCode());
        assertEquals(400, get(PRODUCTS + "/not-a-uuid", admin).statusCode());
    }

    static LocalDate today() { return LocalDate.now(ZoneId.of("America/Mexico_City")); }
    static String encode(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8); }
    UUID product(String sku, String name, String category) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO inventory_product(id, sku, name, category, unit, minimum_stock) VALUES (?, ?, ?, ?, 'pieza', 1)", id, sku, name, category);
        return id;
    }
    UUID lot(UUID product, String batch, LocalDate expiresOn) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO inventory_lot(id, product_id, batch, expires_on, quantity, quarantined) VALUES (?, ?, ?, ?, 4, false)", id, product, batch, expiresOn);
        return id;
    }
    UUID supplier(String reference, String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO purchase_supplier(id, reference, name) VALUES (?, ?, ?)", id, reference, name);
        return id;
    }
    UUID order(String reference, UUID supplier, UUID product, int ageDays) {
        UUID id = UUID.randomUUID();
        var createdAt = OffsetDateTime.of(2026, 1, 1, 12, 0, 0, 0, ZoneOffset.UTC).minusDays(ageDays);
        jdbc.update("INSERT INTO purchase_order(id, reference, supplier_id, order_date, expected_on, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                id, reference, supplier, today(), today().plusDays(1), createdAt);
        jdbc.update("INSERT INTO purchase_line(id, order_id, product_id, position, sku, product_name, category, unit, ordered, unit_cost_cents) SELECT ?, ?, id, 0, sku, name, category, unit, 2, 125 FROM inventory_product WHERE id = ?", UUID.randomUUID(), id, product);
        return id;
    }
    void assertOnly(UUID expected, JsonNode matches) {
        assertEquals(1, matches.size(), matches.toString());
        assertEquals(expected.toString(), matches.get(0).get("id").asString());
    }
    void assertFirstPageExcludes(String path, UUID target) throws Exception {
        var firstPage = items(path);
        assertEquals(50, firstPage.size());
        for (var row : firstPage) assertNotEquals(target.toString(), row.get("id").asString());
    }
    JsonNode items(String path) throws Exception { return ok(get(path, admin), 200).get("items"); }
    JsonNode ok(HttpResponse<String> response, int code) { assertEquals(code, response.statusCode(), response.body()); return json.readTree(response.body()); }
    HttpResponse<String> get(String path, String token) throws Exception {
        var r = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).timeout(java.time.Duration.ofSeconds(20));
        if (token != null) r.header("Authorization", "Bearer " + token);
        return client.send(r.GET().build(), HttpResponse.BodyHandlers.ofString());
    }
}
