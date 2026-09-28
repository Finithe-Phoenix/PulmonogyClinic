package mx.denova.clinic.purchasing;

import static mx.denova.clinic.purchasing.PurchasingModels.*;
import java.time.Clock;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import mx.denova.clinic.api.ApiProblem;
import mx.denova.clinic.inventory.CommandService;
import mx.denova.clinic.inventory.InventoryModels.Category;
import mx.denova.clinic.inventory.InventoryModels.Page;
import mx.denova.clinic.inventory.InventoryService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PurchasingService {
    private final JdbcTemplate jdbc;
    private final CommandService commands;
    private final InventoryService inventory;
    private final Clock clock;
    private static final long MAX_TOTAL_CENTS = 9_000_000_000_000L;
    private static final RowMapper<Supplier> SUPPLIER = (r,n) -> new Supplier(r.getObject("id", UUID.class), r.getString("reference"), r.getString("name"));
    private static final RowMapper<OrderLine> LINE = (r,n) -> new OrderLine(r.getObject("id", UUID.class), r.getObject("product_id", UUID.class), r.getString("sku"), r.getString("product_name"), Category.valueOf(r.getString("category")), r.getString("unit"), r.getInt("ordered"), r.getInt("received"), r.getLong("unit_cost_cents"));
    private static final RowMapper<Receipt> RECEIPT = (r,n) -> new Receipt(r.getObject("id", UUID.class), r.getString("reference"), r.getObject("order_id", UUID.class), r.getObject("line_id", UUID.class), r.getObject("lot_id", UUID.class), r.getObject("movement_id", UUID.class), r.getString("batch"), r.getObject("expires_on", LocalDate.class), r.getBoolean("quarantined"), r.getInt("quantity"), r.getLong("unit_cost_cents"), r.getString("actor"), r.getObject("received_at", OffsetDateTime.class).toInstant());
    private record Header(UUID id, String reference, UUID supplierId, LocalDate date, LocalDate expectedOn,
            String currency, boolean cancelled, String cancellationReason) {}
    private static final RowMapper<Header> HEADER = (r,n) -> new Header(r.getObject("id", UUID.class), r.getString("reference"), r.getObject("supplier_id", UUID.class), r.getObject("order_date", LocalDate.class), r.getObject("expected_on", LocalDate.class), r.getString("currency"), r.getBoolean("cancelled"), r.getString("cancellation_reason"));

    public PurchasingService(JdbcTemplate jdbc, CommandService commands, InventoryService inventory, Clock clock) {
        this.jdbc = jdbc; this.commands = commands; this.inventory = inventory; this.clock = clock;
    }
    public Page<Supplier> suppliers(int limit, int offset) {
        pageBounds(limit, offset);
        return new Page<>(jdbc.query("SELECT * FROM purchase_supplier ORDER BY reference LIMIT ? OFFSET ?", SUPPLIER, limit, offset), limit, offset);
    }
    public Supplier createSupplier(UUID key, String actor, SupplierInput input) {
        return commands.execute(key, actor, "CREATE_SUPPLIER", input, Supplier.class, () -> {
            var supplier = new Supplier(UUID.randomUUID(), input.reference(), input.name());
            jdbc.update("INSERT INTO purchase_supplier(id, reference, name) VALUES (?, ?, ?)", supplier.id(), supplier.reference(), supplier.name());
            audit(key, "SUPPLIER_CREATED", supplier.id(), actor, "Alta de proveedor");
            return supplier;
        });
    }
    public Order createOrder(UUID key, String actor, OrderInput input) {
        return commands.execute(key, actor, "CREATE_PURCHASE_ORDER", input, Order.class, () -> {
            LocalDate date = LocalDate.now(clock);
            if (input.expectedOn().isBefore(date) || input.expectedOn().getYear() > 9999)
                throw invalid("Revisa la fecha de entrega esperada.");
            if (jdbc.query("SELECT * FROM purchase_supplier WHERE id = ?", SUPPLIER, input.supplierId()).isEmpty()) throw ApiProblem.missing();
            var seen = new HashSet<UUID>();
            long total = 0;
            for (var line : input.lines()) {
                if (!seen.add(line.productId())) throw invalid("Un producto solo puede aparecer una vez en la orden.");
                total += (long)line.quantity() * line.unitCostCents();
            }
            if (total > MAX_TOTAL_CENTS) throw invalid("El total de la orden supera el límite permitido.");
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO purchase_order(id, reference, supplier_id, order_date, expected_on) VALUES (?, ?, ?, ?, ?)", id, input.reference(), input.supplierId(), date, input.expectedOn());
            int position = 0;
            for (var line : input.lines()) {
                // Product and monetary snapshots are immutable through this API.
                int inserted = jdbc.update("""
                    INSERT INTO purchase_line(id, order_id, product_id, position, sku, product_name, category, unit, ordered, unit_cost_cents)
                    SELECT ?, ?, id, ?, sku, name, category, unit, ?, ? FROM inventory_product WHERE id = ?
                    """, UUID.randomUUID(), id, position++, line.quantity(), line.unitCostCents(), line.productId());
                if (inserted != 1) throw ApiProblem.missing();
            }
            audit(key, "PURCHASE_ORDER_CREATED", id, actor, "Orden registrada sin afectar existencias");
            return order(id);
        });
    }
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public Order order(UUID id) {
        Header header = header(id, false);
        List<OrderLine> lines = lines(id);
        long total = lines.stream().mapToLong(l -> (long)l.ordered() * l.unitCostCents()).sum();
        long received = lines.stream().mapToLong(l -> (long)l.received() * l.unitCostCents()).sum();
        return new Order(id, header.reference(), header.supplierId(), header.date(), header.expectedOn(), header.currency(), status(header.cancelled(), total, received), header.cancellationReason(), lines, total, received, header.cancelled() ? 0 : total - received);
    }
    public Page<OrderSummary> orders(UUID supplierId, int limit, int offset) {
        pageBounds(limit, offset);
        var args = new ArrayList<Object>();
        String sql = """
            SELECT o.*, sum(l.ordered::bigint * l.unit_cost_cents) total_cents,
                   sum(l.received::bigint * l.unit_cost_cents) received_cents
            FROM purchase_order o JOIN purchase_line l ON l.order_id = o.id
            """;
        if (supplierId != null) { sql += " WHERE o.supplier_id = ?"; args.add(supplierId); }
        sql += " GROUP BY o.id ORDER BY o.created_at DESC, o.id LIMIT ? OFFSET ?";
        args.add(limit); args.add(offset);
        return new Page<>(jdbc.query(sql, (r,n) -> {
            long total = r.getLong("total_cents"), received = r.getLong("received_cents");
            boolean cancelled = r.getBoolean("cancelled");
            return new OrderSummary(r.getObject("id", UUID.class), r.getString("reference"), r.getObject("supplier_id", UUID.class), r.getObject("order_date", LocalDate.class), r.getObject("expected_on", LocalDate.class), r.getString("currency"), status(cancelled, total, received), total, received, cancelled ? 0 : total - received);
        }, args.toArray()), limit, offset);
    }
    public Receipt receive(UUID key, String actor, UUID orderId, ReceiptInput input) {
        return commands.execute(key, actor, "PURCHASE_RECEIPT:" + orderId, input, Receipt.class, () -> {
            // Every receipt and cancellation locks its order first; inventory rows follow.
            Header header = header(orderId, true);
            if (header.cancelled()) throw ApiProblem.conflict("ORDER_CANCELLED", "La orden está cancelada.");
            var matching = jdbc.query("SELECT * FROM purchase_line WHERE id = ? AND order_id = ?", LINE, input.lineId(), orderId);
            if (matching.isEmpty()) throw ApiProblem.missing();
            OrderLine line = matching.getFirst();
            if (input.quantity() > line.ordered() - line.received())
                throw ApiProblem.conflict("OVER_RECEIPT", "La entrega supera la cantidad pendiente de la partida.");
            var movement = inventory.receivePurchaseStock(key, actor, line.productId(), input.batch(), input.expiresOn(), input.quarantined(), input.quantity(), "Recepción " + input.reference() + " / " + header.reference());
            UUID receiptId = UUID.randomUUID();
            jdbc.update("""
                INSERT INTO purchase_receipt(id, reference, command_id, order_id, line_id, lot_id, movement_id,
                    batch, expires_on, quarantined, quantity, unit_cost_cents, actor)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, receiptId, input.reference(), key, orderId, line.id(), movement.lotId(), movement.id(), input.batch(), input.expiresOn(), input.quarantined(), input.quantity(), line.unitCostCents(), actor);
            jdbc.update("UPDATE purchase_line SET received = received + ? WHERE id = ?", input.quantity(), line.id());
            audit(key, "PURCHASE_RECEIVED", orderId, actor, "Recepción " + input.reference());
            return jdbc.queryForObject("SELECT * FROM purchase_receipt WHERE id = ?", RECEIPT, receiptId);
        });
    }
    public Order cancel(UUID key, String actor, UUID id, CancellationInput input) {
        return commands.execute(key, actor, "CANCEL_PURCHASE_ORDER:" + id, input, Order.class, () -> {
            Header header = header(id, true);
            if (header.cancelled()) throw ApiProblem.conflict("ORDER_CANCELLED", "La orden ya está cancelada.");
            if (lines(id).stream().allMatch(l -> l.received() == l.ordered()))
                throw ApiProblem.conflict("ORDER_COMPLETE", "La orden está recibida; no tiene saldo pendiente que cancelar.");
            jdbc.update("UPDATE purchase_order SET cancelled = true, cancellation_reason = ? WHERE id = ?", input.reason(), id);
            audit(key, "PURCHASE_CANCELLED", id, actor, input.reason());
            return order(id);
        });
    }
    public Page<Receipt> receipts(UUID orderId, UUID lotId, int limit, int offset) {
        pageBounds(limit, offset);
        var args = new ArrayList<Object>();
        String sql = "SELECT * FROM purchase_receipt WHERE 1=1";
        if (orderId != null) { sql += " AND order_id = ?"; args.add(orderId); }
        if (lotId != null) { sql += " AND lot_id = ?"; args.add(lotId); }
        sql += " ORDER BY received_at DESC, id LIMIT ? OFFSET ?";
        args.add(limit); args.add(offset);
        return new Page<>(jdbc.query(sql, RECEIPT, args.toArray()), limit, offset);
    }
    private Header header(UUID id, boolean lock) {
        var found = jdbc.query("SELECT * FROM purchase_order WHERE id = ?" + (lock ? " FOR UPDATE" : ""), HEADER, id);
        if (found.isEmpty()) throw ApiProblem.missing();
        return found.getFirst();
    }
    private List<OrderLine> lines(UUID id) { return jdbc.query("SELECT * FROM purchase_line WHERE order_id = ? ORDER BY position", LINE, id); }
    private static OrderStatus status(boolean cancelled, long total, long received) {
        if (cancelled) return OrderStatus.CANCELLED;
        if (received == total) return OrderStatus.RECEIVED;
        return received == 0 ? OrderStatus.PENDING : OrderStatus.PARTIAL;
    }
    private void audit(UUID key, String action, UUID entity, String actor, String reason) {
        jdbc.update("INSERT INTO audit_event(command_id, action, entity_id, actor, reason) VALUES (?, ?, ?, ?, ?)", key, action, entity, actor, reason);
    }
    private static ApiProblem invalid(String message) { return new ApiProblem(HttpStatus.BAD_REQUEST, "INVALID_PURCHASE", message); }
    private static void pageBounds(int limit, int offset) {
        if (limit < 1 || limit > 100 || offset < 0 || offset > 1000000) throw invalid("Revisa los límites de paginación.");
    }
}
