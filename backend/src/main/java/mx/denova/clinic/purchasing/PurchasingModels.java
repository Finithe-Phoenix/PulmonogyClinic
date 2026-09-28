package mx.denova.clinic.purchasing;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import mx.denova.clinic.inventory.InventoryModels.Category;

public final class PurchasingModels {
    private PurchasingModels() {}
    public enum OrderStatus { PENDING, PARTIAL, RECEIVED, CANCELLED }
    public record Supplier(UUID id, String reference, String name) {}
    public record SupplierInput(@NotBlank @Size(max=80) String reference, @NotBlank @Size(max=160) String name) {
        public SupplierInput { reference = normalize(reference); name = trim(name); }
    }
    public record LineInput(@NotNull UUID productId, @Min(1) @Max(1000000) int quantity,
            @Min(1) @Max(100000000) long unitCostCents) {}
    public record OrderInput(@NotBlank @Size(max=80) String reference, @NotNull UUID supplierId,
            @NotNull LocalDate expectedOn, @NotEmpty @Size(max=100) List<@NotNull @Valid LineInput> lines) {
        public OrderInput { reference = normalize(reference); }
    }
    public record OrderLine(UUID id, UUID productId, String sku, String productName, Category category,
            String unit, int ordered, int received, long unitCostCents) {}
    public record Order(UUID id, String reference, UUID supplierId, LocalDate orderDate, LocalDate expectedOn,
            String currency, OrderStatus status, String cancellationReason, List<OrderLine> lines,
            long totalCents, long receivedCents, long pendingCents) {}
    public record OrderSummary(UUID id, String reference, UUID supplierId, LocalDate orderDate, LocalDate expectedOn,
            String currency, OrderStatus status, long totalCents, long receivedCents, long pendingCents) {}
    public record ReceiptInput(@NotBlank @Size(max=80) String reference, @NotNull UUID lineId,
            @Min(1) @Max(1000000) int quantity, @NotBlank @Size(max=80) String batch,
            LocalDate expiresOn, @NotNull Boolean quarantined) {
        public ReceiptInput { reference = normalize(reference); batch = normalize(batch); }
    }
    public record Receipt(UUID id, String reference, UUID orderId, UUID lineId, UUID lotId, UUID movementId,
            String batch, LocalDate expiresOn, boolean quarantined, int quantity, long unitCostCents,
            String actor, Instant receivedAt) {}
    public record CancellationInput(@NotBlank @Size(max=240) String reason) {
        public CancellationInput { reason = trim(reason); }
    }
    private static String trim(String value) { return value == null ? null : value.strip(); }
    private static String normalize(String value) { return value == null ? null : value.strip().toUpperCase(Locale.ROOT); }
}
