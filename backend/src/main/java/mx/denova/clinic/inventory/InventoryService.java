package mx.denova.clinic.inventory;

import static mx.denova.clinic.inventory.InventoryModels.*;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.Objects;
import mx.denova.clinic.api.ApiProblem;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryService {
    private final JdbcTemplate jdbc;
    private final CommandService commands;
    private final Clock clock;
    private static final RowMapper<Product> PRODUCT = (r, n) -> new Product(r.getObject("id", UUID.class), r.getString("sku"), r.getString("name"), Category.valueOf(r.getString("category")), r.getString("unit"), r.getInt("minimum_stock"));
    private static final RowMapper<Lot> LOT = (r, n) -> new Lot(r.getObject("id", UUID.class), r.getObject("product_id", UUID.class), r.getString("batch"), r.getObject("expires_on", LocalDate.class), r.getInt("quantity"), r.getBoolean("quarantined"));
    private static final RowMapper<Movement> MOVEMENT = (r, n) -> new Movement(r.getObject("id", UUID.class), r.getObject("lot_id", UUID.class), MovementKind.valueOf(r.getString("kind")), r.getInt("quantity"), r.getInt("balance_after"), r.getString("reason"), r.getString("actor"), r.getObject("created_at", OffsetDateTime.class).toInstant());
    public InventoryService(JdbcTemplate jdbc, CommandService commands, Clock clock) { this.jdbc = jdbc; this.commands = commands; this.clock = clock; }

    public Page<Product> products(int limit, int offset) {
        pageBounds(limit, offset);
        return new Page<>(jdbc.query("SELECT * FROM inventory_product ORDER BY sku LIMIT ? OFFSET ?", PRODUCT, limit, offset), limit, offset);
    }
    public Product createProduct(UUID key, String actor, ProductInput input) {
        return commands.execute(key, actor, "CREATE_PRODUCT", input, Product.class, () -> {
            var product = new Product(UUID.randomUUID(), input.sku(), input.name(), input.category(), input.unit(), input.minimumStock());
            jdbc.update("INSERT INTO inventory_product VALUES (?, ?, ?, ?, ?, ?)", product.id(), product.sku(), product.name(), product.category().name(), product.unit(), product.minimumStock());
            audit(key, "PRODUCT_CREATED", product.id(), actor, "Alta de producto");
            return product;
        });
    }
    public Page<Lot> lots(UUID productId, boolean availableOnly, int limit, int offset) {
        pageBounds(limit, offset);
        var args = new java.util.ArrayList<Object>();
        String sql = "SELECT * FROM inventory_lot WHERE 1=1";
        if (productId != null) { sql += " AND product_id = ?"; args.add(productId); }
        if (availableOnly) { sql += " AND quantity > 0 AND NOT quarantined AND (expires_on IS NULL OR expires_on >= ?)"; args.add(LocalDate.now(clock)); }
        sql += " ORDER BY expires_on NULLS LAST, id LIMIT ? OFFSET ?";
        args.add(limit); args.add(offset);
        return new Page<>(jdbc.query(sql, LOT, args.toArray()), limit, offset);
    }
    public Lot lot(UUID id) { return findLot(id, false); }
    public Lot createLot(UUID key, String actor, LotInput input) {
        return commands.execute(key, actor, "CREATE_LOT", input, Lot.class, () -> {
            var products = jdbc.query("SELECT * FROM inventory_product WHERE id = ?", PRODUCT, input.productId());
            if (products.isEmpty()) throw ApiProblem.missing();
            if (products.getFirst().category() == Category.FARMACIA && input.expiresOn() == null)
                throw new ApiProblem(HttpStatus.BAD_REQUEST, "EXPIRY_REQUIRED", "Los productos de farmacia requieren caducidad.");
            var lot = new Lot(UUID.randomUUID(), input.productId(), input.batch(), input.expiresOn(), 0, input.quarantined());
            jdbc.update("INSERT INTO inventory_lot VALUES (?, ?, ?, ?, 0, ?)", lot.id(), lot.productId(), lot.batch(), lot.expiresOn(), lot.quarantined());
            audit(key, "LOT_CREATED", lot.id(), actor, "Alta de lote sin existencias");
            return lot;
        });
    }
    public Movement move(UUID key, String actor, UUID lotId, MovementInput input, boolean admin) {
        if (input.kind() == MovementKind.DISPOSAL && !admin)
            throw new ApiProblem(HttpStatus.FORBIDDEN, "ADMIN_REQUIRED", "La baja requiere autorización administrativa.");
        return commands.execute(key, actor, "MOVE:" + lotId, input, Movement.class, () -> {
            Lot lot = findLot(lotId, true);
            return writeMovement(key, actor, lot, input);
        });
    }
    // Internal purchasing operation: it must join the receipt's existing transaction.
    // This method has no controller route and does not reserve a second command key.
    @Transactional(propagation = Propagation.MANDATORY)
    public Movement receivePurchaseStock(UUID key, String actor, UUID productId, String batch,
            LocalDate expiresOn, boolean quarantined, int quantity, String reason) {
        var products = jdbc.query("SELECT * FROM inventory_product WHERE id = ?", PRODUCT, productId);
        if (products.isEmpty()) throw ApiProblem.missing();
        if (products.getFirst().category() == Category.FARMACIA && expiresOn == null)
            throw new ApiProblem(HttpStatus.BAD_REQUEST, "EXPIRY_REQUIRED", "Los productos de farmacia requieren caducidad.");
        if (expiresOn != null && expiresOn.isBefore(LocalDate.now(clock)))
            throw ApiProblem.conflict("LOT_EXPIRED", "No se recibe mercancía caducada.");
        int created = jdbc.update("INSERT INTO inventory_lot(id, product_id, batch, expires_on, quantity, quarantined) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT (product_id, batch) DO NOTHING",
                UUID.randomUUID(), productId, batch, expiresOn, quarantined);
        Lot lot = jdbc.queryForObject("SELECT * FROM inventory_lot WHERE product_id = ? AND batch = ? FOR UPDATE", LOT, productId, batch);
        if (!Objects.equals(lot.expiresOn(), expiresOn) || lot.quarantined() != quarantined)
            throw ApiProblem.conflict("LOT_CONDITION_MISMATCH", "La caducidad o condición no coincide con el lote existente.");
        if (created == 1) audit(key, "LOT_CREATED", lot.id(), actor, "Lote creado desde recepción de compra");
        return writeMovement(key, actor, lot, new MovementInput(MovementKind.RECEIPT, quantity, reason));
    }
    private Movement writeMovement(UUID key, String actor, Lot lot, MovementInput input) {
        boolean expired = lot.expiresOn() != null && lot.expiresOn().isBefore(LocalDate.now(clock));
        if (input.kind() != MovementKind.DISPOSAL && expired)
            throw ApiProblem.conflict("LOT_EXPIRED", "El lote está caducado.");
        if (input.kind() == MovementKind.ISSUE && lot.quarantined())
            throw ApiProblem.conflict("LOT_QUARANTINED", "El lote está en cuarentena.");
        long balance = (long)lot.quantity() + (input.kind() == MovementKind.RECEIPT ? input.quantity() : -input.quantity());
        if (balance < 0) throw ApiProblem.conflict("INSUFFICIENT_STOCK", "No hay unidades suficientes.");
        if (balance > 1000000000) throw ApiProblem.conflict("STOCK_LIMIT", "La cantidad supera el límite permitido.");
        UUID id = UUID.randomUUID();
        jdbc.update("UPDATE inventory_lot SET quantity = ? WHERE id = ?", balance, lot.id());
        jdbc.update("INSERT INTO inventory_movement(id, command_id, lot_id, kind, quantity, balance_after, reason, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, key, lot.id(), input.kind().name(), input.quantity(), balance, input.reason(), actor);
        audit(key, input.kind().name(), lot.id(), actor, input.reason());
        return jdbc.queryForObject("SELECT * FROM inventory_movement WHERE id = ?", MOVEMENT, id);
    }
    public Lot quarantine(UUID key, String actor, UUID lotId, QuarantineInput input) {
        return commands.execute(key, actor, "QUARANTINE:" + lotId, input, Lot.class, () -> {
            Lot lot = findLot(lotId, true);
            if (!input.quarantined() && lot.expiresOn() != null && lot.expiresOn().isBefore(LocalDate.now(clock)))
                throw ApiProblem.conflict("LOT_EXPIRED", "Un lote caducado no se puede liberar.");
            jdbc.update("UPDATE inventory_lot SET quarantined = ? WHERE id = ?", input.quarantined(), lotId);
            audit(key, input.quarantined() ? "QUARANTINE_SET" : "QUARANTINE_RELEASED", lotId, actor, input.reason());
            return findLot(lotId, false);
        });
    }
    public Page<Movement> movements(UUID lotId, int limit, int offset) {
        pageBounds(limit, offset);
        return new Page<>(lotId == null
            ? jdbc.query("SELECT * FROM inventory_movement ORDER BY created_at DESC, id LIMIT ? OFFSET ?", MOVEMENT, limit, offset)
            : jdbc.query("SELECT * FROM inventory_movement WHERE lot_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?", MOVEMENT, lotId, limit, offset), limit, offset);
    }
    public Page<AuditEvent> events(int limit, int offset) {
        pageBounds(limit, offset);
        return new Page<>(jdbc.query("SELECT * FROM audit_event ORDER BY id DESC LIMIT ? OFFSET ?", (r,n) -> new AuditEvent(r.getLong("id"), r.getObject("command_id", UUID.class), r.getString("action"), r.getObject("entity_id", UUID.class), r.getString("actor"), r.getString("reason"), r.getObject("created_at", OffsetDateTime.class).toInstant()), limit, offset), limit, offset);
    }
    private Lot findLot(UUID id, boolean lock) {
        var lots = jdbc.query("SELECT * FROM inventory_lot WHERE id = ?" + (lock ? " FOR UPDATE" : ""), LOT, id);
        if (lots.isEmpty()) throw ApiProblem.missing();
        return lots.getFirst();
    }
    private void audit(UUID key, String action, UUID entity, String actor, String reason) {
        jdbc.update("INSERT INTO audit_event(command_id, action, entity_id, actor, reason) VALUES (?, ?, ?, ?, ?)", key, action, entity, actor, reason);
    }
    private void pageBounds(int limit, int offset) {
        if (limit < 1 || limit > 100 || offset < 0 || offset > 1000000)
            throw new ApiProblem(HttpStatus.BAD_REQUEST, "INVALID_PAGE", "El límite debe ser de 1 a 100 y el desplazamiento de 0 a 1000000.");
    }
}
