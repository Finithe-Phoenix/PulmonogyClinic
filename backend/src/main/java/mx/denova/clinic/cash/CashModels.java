package mx.denova.clinic.cash;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

public final class CashModels {
    private CashModels() {}
    public static final long MAX_CENTS = 9_000_000_000_000L;
    public enum Method { CASH, CARD, TRANSFER }
    public enum Status { OPEN, CLOSED }
    public record ShiftInput(@NotBlank @Size(max=80) String reference,
            @NotNull @Min(0) @Max(MAX_CENTS) Long openingFloatCents) {
        public ShiftInput { reference = normalize(reference); }
    }
    public record PaymentInput(@NotBlank @Size(max=80) String reference,
            @NotNull @Min(1) @Max(MAX_CENTS) Long amountCents, @NotNull Method method,
            @Size(max=80) String operationReference) {
        public PaymentInput {
            reference = normalize(reference); operationReference = normalize(operationReference);
            if (operationReference != null && operationReference.isEmpty()) operationReference = null;
        }
    }
    public record ReverseInput(@NotBlank @Size(max=240) String reason) {
        public ReverseInput { reason = trim(reason); }
    }
    public record CloseInput(@NotNull @Min(0) @Max(MAX_CENTS) Long countedCashCents,
            @NotBlank @Size(max=240) String reason) {
        public CloseInput { reason = trim(reason); }
    }
    public record Shift(UUID id, String reference, Status status, String currency, long openingFloatCents,
            long cashTotalCents, long cardTotalCents, long transferTotalCents, long expectedCashCents,
            Long countedCashCents, Long differenceCents, Instant openedAt, String openedBy,
            Instant closedAt, String closedBy, String closureReason) {}
    public record Payment(UUID id, UUID shiftId, String reference, long amountCents, Method method,
            String operationReference, Instant createdAt, String actor, boolean reversed,
            Instant reversedAt, String reversedBy, String reversalReason) {}
    private static String trim(String value) { return value == null ? null : value.strip(); }
    private static String normalize(String value) { return value == null ? null : value.strip().toUpperCase(Locale.ROOT); }
}
