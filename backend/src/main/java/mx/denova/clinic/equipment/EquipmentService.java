package mx.denova.clinic.equipment;

import static mx.denova.clinic.equipment.EquipmentModels.*;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.UUID;
import mx.denova.clinic.api.ApiProblem;
import mx.denova.clinic.inventory.CommandService;
import mx.denova.clinic.inventory.InventoryModels.Page;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EquipmentService {
    private final JdbcTemplate jdbc;
    private final CommandService commands;
    private final Clock clock;

    private static final String ASSET_SELECT = """
        SELECT a.*, (SELECT m.next_due_on FROM equipment_maintenance m WHERE m.asset_id = a.id
            ORDER BY m.performed_on DESC, m.asset_version DESC LIMIT 1) AS next_due_on
        FROM equipment_asset a
        """;
    private static final RowMapper<Asset> ASSET = (r,n) -> new Asset(r.getObject("id", UUID.class),
            r.getString("reference"), r.getString("name"), r.getString("location"), r.getString("serial_number"),
            AssetStatus.valueOf(r.getString("status")), r.getLong("version"), r.getObject("next_due_on", LocalDate.class),
            r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getObject("updated_at", OffsetDateTime.class).toInstant());
    private static final RowMapper<Maintenance> MAINTENANCE = (r,n) -> new Maintenance(r.getObject("id", UUID.class),
            r.getObject("asset_id", UUID.class), r.getObject("performed_on", LocalDate.class), r.getObject("next_due_on", LocalDate.class),
            r.getString("description"), r.getString("technician"), r.getString("actor"),
            r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getLong("asset_version"));

    public EquipmentService(JdbcTemplate jdbc, CommandService commands, Clock clock) {
        this.jdbc = jdbc; this.commands = commands; this.clock = clock;
    }

    public Page<Asset> assets(String q, AssetStatus status, int limit, int offset) {
        pageBounds(limit, offset);
        String query = q == null ? "" : q.strip();
        if (query.length() > 160) throw invalid("La búsqueda admite hasta 160 caracteres.");
        var args = new ArrayList<Object>();
        String sql = ASSET_SELECT + " WHERE 1=1";
        if (!query.isEmpty()) {
            // POSITION treats %, _ and backslashes as literal search text, not wildcards.
            sql += " AND position(lower(?) in lower(concat_ws(' ', a.reference, a.name, a.location, a.serial_number))) > 0";
            args.add(query);
        }
        if (status != null) { sql += " AND a.status = ?"; args.add(status.name()); }
        sql += " ORDER BY a.reference, a.id LIMIT ? OFFSET ?";
        args.add(limit); args.add(offset);
        return new Page<>(jdbc.query(sql, ASSET, args.toArray()), limit, offset);
    }

    public Asset asset(UUID id) { return asset(id, false); }

    // Called by agenda inside its command transaction. Generic rooms/resources remain valid.
    // The row lock serializes booking/start with availability changes on a registered device.
    @Transactional(propagation = Propagation.MANDATORY)
    public void assertResourceAvailable(String normalizedReference) {
        var states = jdbc.query("SELECT status FROM equipment_asset WHERE reference = ? FOR UPDATE",
                (r,n) -> r.getString("status"), normalizedReference);
        if (!states.isEmpty() && !AssetStatus.AVAILABLE.name().equals(states.getFirst()))
            throw ApiProblem.conflict("EQUIPMENT_UNAVAILABLE", "El equipo asignado está en mantenimiento o fuera de servicio. Selecciona otro recurso.");
    }

    public Asset create(UUID key, String actor, AssetInput input) {
        return commands.execute(key, actor, "CREATE_EQUIPMENT_ASSET", input, Asset.class, () -> {
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO equipment_asset(id, reference, name, location, serial_number) VALUES (?, ?, ?, ?, ?)",
                    id, input.reference(), input.name(), input.location(), input.serialNumber());
            audit(key, "EQUIPMENT_CREATED", id, actor, "Alta de equipo reutilizable");
            return asset(id);
        });
    }

    public Asset changeStatus(UUID key, String actor, UUID id, StatusInput input) {
        return commands.execute(key, actor, "EQUIPMENT_STATUS:" + id, input, Asset.class, () -> {
            Asset current = asset(id, true);
            checkVersion(current, input.expectedVersion());
            if (current.status() == input.status())
                throw ApiProblem.conflict("EQUIPMENT_SAME_STATUS", "El equipo ya tiene esa disponibilidad.");
            jdbc.update("UPDATE equipment_asset SET status = ?, version = version + 1, updated_at = now() WHERE id = ?",
                    input.status().name(), id);
            audit(key, "EQUIPMENT_STATUS_CHANGED", id, actor,
                    current.status().name() + " → " + input.status().name() + ": " + input.reason());
            return asset(id);
        });
    }

    public Page<Maintenance> maintenance(UUID id, int limit, int offset) {
        pageBounds(limit, offset);
        asset(id);
        return new Page<>(jdbc.query("SELECT * FROM equipment_maintenance WHERE asset_id = ? ORDER BY performed_on DESC, asset_version DESC LIMIT ? OFFSET ?",
                MAINTENANCE, id, limit, offset), limit, offset);
    }

    public Maintenance recordMaintenance(UUID key, String actor, UUID id, MaintenanceInput input) {
        return commands.execute(key, actor, "RECORD_EQUIPMENT_MAINTENANCE:" + id, input, Maintenance.class, () -> {
            validateDates(input);
            Asset current = asset(id, true);
            checkVersion(current, input.expectedVersion());
            UUID maintenanceId = UUID.randomUUID();
            long nextVersion = current.version() + 1;
            jdbc.update("""
                INSERT INTO equipment_maintenance(id, asset_id, command_id, performed_on, next_due_on,
                    description, technician, actor, asset_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, maintenanceId, id, key, input.performedOn(), input.nextDueOn(), input.description(),
                    input.technician(), actor, nextVersion);
            // Maintenance never implicitly releases a device or asserts calibration/certification.
            jdbc.update("UPDATE equipment_asset SET version = ?, updated_at = now() WHERE id = ?", nextVersion, id);
            audit(key, "EQUIPMENT_MAINTENANCE_RECORDED", id, actor, "Intervención registrada; consultar historial del equipo");
            return jdbc.queryForObject("SELECT * FROM equipment_maintenance WHERE id = ?", MAINTENANCE, maintenanceId);
        });
    }

    private Asset asset(UUID id, boolean lock) {
        var found = jdbc.query(ASSET_SELECT + " WHERE a.id = ?" + (lock ? " FOR UPDATE OF a" : ""), ASSET, id);
        if (found.isEmpty()) throw ApiProblem.missing();
        return found.getFirst();
    }

    private void validateDates(MaintenanceInput input) {
        if (input.performedOn().getYear() < 1900 || input.performedOn().isAfter(LocalDate.now(clock)))
            throw invalid("La intervención debe estar realizada, con fecha desde 1900 y no posterior a hoy.");
        if (input.nextDueOn() != null && (!input.nextDueOn().isAfter(input.performedOn()) || input.nextDueOn().getYear() > 9999))
            throw invalid("La próxima intervención debe ser posterior a la realizada y tener un año de cuatro cifras.");
    }

    private void checkVersion(Asset asset, long expected) {
        if (asset.version() != expected)
            throw ApiProblem.conflict("STALE_VERSION", "El equipo cambió desde que lo abriste. Actualiza los datos y revisa tu operación.");
    }

    private void audit(UUID key, String action, UUID id, String actor, String reason) {
        jdbc.update("INSERT INTO audit_event(command_id, action, entity_id, actor, reason) VALUES (?, ?, ?, ?, ?)",
                key, action, id, actor, reason);
    }

    private static ApiProblem invalid(String message) { return new ApiProblem(HttpStatus.BAD_REQUEST, "INVALID_EQUIPMENT", message); }
    private static void pageBounds(int limit, int offset) {
        if (limit < 1 || limit > 100 || offset < 0 || offset > 1000000) throw invalid("Revisa los límites de paginación.");
    }
}
