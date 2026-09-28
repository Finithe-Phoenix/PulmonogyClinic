package mx.denova.clinic.inventory;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Locale;
import java.util.UUID;

public final class InventoryModels {
    private InventoryModels() {}
    public enum Category { FARMACIA, INSUMOS }
    public enum MovementKind { RECEIPT, ISSUE, DISPOSAL }
    public record Product(UUID id, String sku, String name, Category category, String unit, int minimumStock) {}
    public record ProductInput(@NotBlank @Pattern(regexp="[A-Z0-9-]{2,40}") String sku,
            @NotBlank @Size(max=160) String name, @NotNull Category category,
            @NotBlank @Size(max=40) String unit, @Min(0) @Max(1000000) int minimumStock) {
        public ProductInput { sku = normalize(sku); name = trim(name); unit = trim(unit); }
    }
    public record Lot(UUID id, UUID productId, String batch, LocalDate expiresOn, int quantity, boolean quarantined) {}
    public record LotInput(@NotNull UUID productId, @NotBlank @Size(max=80) String batch,
            LocalDate expiresOn, boolean quarantined) { public LotInput { batch = normalize(batch); } }
    public record Movement(UUID id, UUID lotId, MovementKind kind, int quantity, int balanceAfter,
            String reason, String actor, Instant createdAt) {}
    public record MovementInput(@NotNull MovementKind kind, @Min(1) @Max(1000000) int quantity,
            @NotBlank @Size(max=240) String reason) { public MovementInput { reason = trim(reason); } }
    public record QuarantineInput(boolean quarantined, @NotBlank @Size(max=240) String reason) {
        public QuarantineInput { reason = trim(reason); }
    }
    public record AuditEvent(long id, UUID commandId, String action, UUID entityId, String actor, String reason, Instant createdAt) {}
    public record Page<T>(java.util.List<T> items, int limit, int offset) {}
    private static String trim(String value) { return value == null ? null : value.strip(); }
    private static String normalize(String value) { return value == null ? null : value.strip().toUpperCase(Locale.ROOT); }
}
