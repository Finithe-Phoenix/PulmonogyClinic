package mx.denova.clinic.cash;

import static mx.denova.clinic.cash.CashModels.*;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;
import mx.denova.clinic.api.ApiProblem;
import mx.denova.clinic.inventory.CommandService;
import mx.denova.clinic.inventory.InventoryModels.Page;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

@Service
public class CashService {
    private final JdbcTemplate jdbc;
    private final CommandService commands;
    private static final String SHIFT_SELECT = """
        SELECT s.*, coalesce(t.cash, 0) cash_total, coalesce(t.card, 0) card_total,
            coalesce(t.transfer, 0) transfer_total
        FROM cash_shift s LEFT JOIN LATERAL (
            SELECT sum(p.amount_cents) FILTER (WHERE p.method = 'CASH') cash,
                sum(p.amount_cents) FILTER (WHERE p.method = 'CARD') card,
                sum(p.amount_cents) FILTER (WHERE p.method = 'TRANSFER') transfer
            FROM cash_payment p LEFT JOIN cash_reversal r ON r.payment_id = p.id
            WHERE p.shift_id = s.id AND r.id IS NULL
        ) t ON true
        """;
    private static final String PAYMENT_SELECT = """
        SELECT p.*, r.created_at reversed_at, r.actor reversed_by, r.reason reversal_reason
        FROM cash_payment p LEFT JOIN cash_reversal r ON r.payment_id = p.id
        """;
    private static final RowMapper<Shift> SHIFT = (r,n) -> {
        Instant closed = instant(r, "closed_at");
        long expected = closed == null ? r.getLong("opening_float_cents") + r.getLong("cash_total") : r.getLong("expected_cash_cents");
        Long counted = r.getObject("counted_cash_cents", Long.class);
        return new Shift(r.getObject("id", UUID.class), r.getString("reference"), closed == null ? Status.OPEN : Status.CLOSED,
            "MXN", r.getLong("opening_float_cents"), r.getLong("cash_total"), r.getLong("card_total"),
            r.getLong("transfer_total"), expected, counted, counted == null ? null : counted - expected,
            instant(r, "opened_at"), r.getString("opened_by"), closed, r.getString("closed_by"), r.getString("closure_reason"));
    };
    private static final RowMapper<Payment> PAYMENT = (r,n) -> new Payment(r.getObject("id", UUID.class),
        r.getObject("shift_id", UUID.class), r.getString("reference"), r.getLong("amount_cents"), Method.valueOf(r.getString("method")),
        r.getString("operation_reference"), instant(r, "created_at"), r.getString("actor"),
        instant(r, "reversed_at") != null, instant(r, "reversed_at"), r.getString("reversed_by"), r.getString("reversal_reason"));

    public CashService(JdbcTemplate jdbc, CommandService commands) { this.jdbc = jdbc; this.commands = commands; }

    public Page<Shift> shifts(int limit, int offset) {
        pageBounds(limit, offset);
        return new Page<>(jdbc.query(SHIFT_SELECT + " ORDER BY s.opened_at DESC, s.id LIMIT ? OFFSET ?", SHIFT, limit, offset), limit, offset);
    }
    public Shift shift(UUID id) {
        var rows = jdbc.query(SHIFT_SELECT + " WHERE s.id = ?", SHIFT, id);
        if (rows.isEmpty()) throw ApiProblem.missing();
        return rows.getFirst();
    }
    public Shift open(UUID key, String actor, ShiftInput input) {
        return commands.execute(key, actor, "OPEN_CASH_SHIFT", input, Shift.class, () -> {
            // The partial unique index is the authority for concurrent first openings.
            if (Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM cash_shift WHERE closed_at IS NULL)", Boolean.class)))
                throw ApiProblem.conflict("SHIFT_ALREADY_OPEN", "Ya existe un turno abierto. Revísalo antes de abrir otro.");
            UUID id = UUID.randomUUID();
            jdbc.update("""
                INSERT INTO cash_shift(id, reference, opening_command_id, opening_float_cents, opened_by)
                VALUES (?, ?, ?, ?, ?)
                """, id, input.reference(), key, input.openingFloatCents(), actor);
            audit(key, "CASH_SHIFT_OPENED", id, actor, "Apertura de turno " + input.reference());
            return shift(id);
        });
    }
    public Page<Payment> payments(UUID shiftId, int limit, int offset) {
        pageBounds(limit, offset);
        shift(shiftId);
        return new Page<>(jdbc.query(PAYMENT_SELECT + " WHERE p.shift_id = ? ORDER BY p.created_at DESC, p.id LIMIT ? OFFSET ?", PAYMENT, shiftId, limit, offset), limit, offset);
    }
    public Payment pay(UUID key, String actor, UUID shiftId, PaymentInput input) {
        return commands.execute(key, actor, "CASH_PAYMENT:" + shiftId, input, Payment.class, () -> {
            lockOpen(shiftId);
            Shift current = shift(shiftId);
            long aggregate = current.openingFloatCents() + current.cashTotalCents() + current.cardTotalCents() + current.transferTotalCents();
            if (input.amountCents() > MAX_CENTS - aggregate)
                throw new ApiProblem(HttpStatus.BAD_REQUEST, "CASH_LIMIT", "El importe supera el límite total del turno.");
            UUID id = UUID.randomUUID();
            jdbc.update("""
                INSERT INTO cash_payment(id, shift_id, command_id, reference, amount_cents, method, operation_reference, actor)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, id, shiftId, key, input.reference(), input.amountCents(), input.method().name(), input.operationReference(), actor);
            audit(key, "CASH_PAYMENT_RECORDED", id, actor, "Cobro " + input.reference());
            return payment(id);
        });
    }
    public Payment reverse(UUID key, String actor, UUID paymentId, ReverseInput input) {
        return commands.execute(key, actor, "REVERSE_CASH_PAYMENT:" + paymentId, input, Payment.class, () -> {
            Payment original = payment(paymentId);
            // The payment is immutable; lock its shift before re-reading reversal state.
            lockOpen(original.shiftId());
            if (payment(paymentId).reversed())
                throw ApiProblem.conflict("PAYMENT_ALREADY_REVERSED", "El cobro ya tiene un reverso registrado.");
            jdbc.update("INSERT INTO cash_reversal(id, payment_id, command_id, reason, actor) VALUES (?, ?, ?, ?, ?)",
                UUID.randomUUID(), paymentId, key, input.reason(), actor);
            audit(key, "CASH_PAYMENT_REVERSED", paymentId, actor, input.reason());
            return payment(paymentId);
        });
    }
    public Shift close(UUID key, String actor, UUID shiftId, CloseInput input) {
        return commands.execute(key, actor, "CLOSE_CASH_SHIFT:" + shiftId, input, Shift.class, () -> {
            lockOpen(shiftId);
            Shift current = shift(shiftId);
            jdbc.update("""
                UPDATE cash_shift SET closing_command_id = ?, closed_by = ?, closed_at = clock_timestamp(),
                    counted_cash_cents = ?, expected_cash_cents = ?, closure_reason = ? WHERE id = ?
                """, key, actor, input.countedCashCents(), current.expectedCashCents(), input.reason(), shiftId);
            audit(key, "CASH_SHIFT_CLOSED", shiftId, actor, input.reason());
            return shift(shiftId);
        });
    }
    private Payment payment(UUID id) {
        var rows = jdbc.query(PAYMENT_SELECT + " WHERE p.id = ?", PAYMENT, id);
        if (rows.isEmpty()) throw ApiProblem.missing();
        return rows.getFirst();
    }
    private void lockOpen(UUID id) {
        var states = jdbc.query("SELECT closed_at IS NULL is_open FROM cash_shift WHERE id = ? FOR UPDATE",
            (r,n) -> r.getBoolean("is_open"), id);
        if (states.isEmpty()) throw ApiProblem.missing();
        if (!states.getFirst()) throw ApiProblem.conflict("SHIFT_CLOSED", "El turno está cerrado; no admite más movimientos.");
    }
    private void audit(UUID key, String action, UUID entity, String actor, String reason) {
        jdbc.update("INSERT INTO audit_event(command_id, action, entity_id, actor, reason) VALUES (?, ?, ?, ?, ?)", key, action, entity, actor, reason);
    }
    private static Instant instant(ResultSet row, String column) throws SQLException {
        OffsetDateTime time = row.getObject(column, OffsetDateTime.class);
        return time == null ? null : time.toInstant();
    }
    private static void pageBounds(int limit, int offset) {
        if (limit < 1 || limit > 100 || offset < 0 || offset > 1000000)
            throw new ApiProblem(HttpStatus.BAD_REQUEST, "INVALID_CASH_PAGE", "Revisa los límites de paginación.");
    }
}
