package mx.denova.clinic.inventory;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import java.util.function.Supplier;
import mx.denova.clinic.api.ApiProblem;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

@Service
public class CommandService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    public CommandService(JdbcTemplate jdbc, ObjectMapper json) { this.jdbc = jdbc; this.json = json; }

    // The unique key serializes concurrent retries before any inventory row is changed.
    // Failed operations roll back the key, stock, movement and audit together.
    @Transactional(timeout = 15)
    public <T> T execute(UUID key, String actor, String operation, Object input, Class<T> type, Supplier<T> action) {
        String hash = fingerprint(operation + "\n" + json.writeValueAsString(input));
        int inserted = jdbc.update("INSERT INTO inventory_command(id, request_hash, actor) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", key, hash, actor);
        if (inserted == 0) {
            var existing = jdbc.queryForMap("SELECT request_hash, actor, result::text FROM inventory_command WHERE id = ?", key);
            if (!hash.equals(existing.get("request_hash")) || !actor.equals(existing.get("actor")))
                throw ApiProblem.conflict("IDEMPOTENCY_CONFLICT", "La clave ya se usó para otra solicitud o usuario.");
            return json.readValue((String) existing.get("result"), type);
        }
        T result = action.get();
        jdbc.update("UPDATE inventory_command SET result = ?::jsonb WHERE id = ?", json.writeValueAsString(result), key);
        return result;
    }

    private String fingerprint(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
}
