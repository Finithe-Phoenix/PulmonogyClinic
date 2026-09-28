package mx.denova.clinic;

import static org.junit.jupiter.api.Assertions.*;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

class MigrationUpgradeTest {
    @Test void upgradingExistingV1PreservesStockAndProtectedHistory() {
        String url = env("TEST_DB_URL", "jdbc:postgresql://127.0.0.1:5432/clinic_test");
        String user = env("TEST_DB_USER", "clinic_test"), password = env("TEST_DB_PASSWORD", "synthetic-ci-only");
        String schema = "upgrade_" + UUID.randomUUID().toString().replace("-", "");
        var jdbc = new JdbcTemplate(new DriverManagerDataSource(url, user, password));
        jdbc.execute("CREATE SCHEMA " + schema);
        try {
            Flyway.configure().dataSource(url, user, password).schemas(schema).defaultSchema(schema).target("1").load().migrate();
            UUID product = UUID.randomUUID(), lot = UUID.randomUUID(), command = UUID.randomUUID(), movement = UUID.randomUUID();
            jdbc.update("INSERT INTO " + schema + ".inventory_product VALUES (?, 'LEGACY-01', 'Ejemplo previo', 'INSUMOS', 'pieza', 2)", product);
            jdbc.update("INSERT INTO " + schema + ".inventory_lot VALUES (?, ?, 'LEGACY-BATCH', null, 7, false)", lot, product);
            jdbc.update("INSERT INTO " + schema + ".inventory_command(id, request_hash, actor, result) VALUES (?, ?, 'migration-test', '{}'::jsonb)", command, "a".repeat(64));
            jdbc.update("INSERT INTO " + schema + ".inventory_movement(id, command_id, lot_id, kind, quantity, balance_after, reason, actor) VALUES (?, ?, ?, 'RECEIPT', 7, 7, 'Ejemplo previo', 'migration-test')", movement, command, lot);
            Flyway.configure().dataSource(url, user, password).schemas(schema).defaultSchema(schema).load().migrate();
            assertEquals(7, jdbc.queryForObject("SELECT quantity FROM " + schema + ".inventory_lot WHERE id = ?", Integer.class, lot));
            assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".inventory_movement", Integer.class));
            assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM " + schema + ".purchase_order", Integer.class));
            assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update("DELETE FROM " + schema + ".inventory_movement"));
        } finally {
            jdbc.execute("DROP SCHEMA " + schema + " CASCADE");
        }
    }
    private static String env(String key, String fallback) { return System.getenv().getOrDefault(key, fallback); }
}
