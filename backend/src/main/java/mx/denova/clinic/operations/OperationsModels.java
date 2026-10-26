package mx.denova.clinic.operations;

import jakarta.validation.constraints.*;
import java.text.Normalizer;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

public final class OperationsModels {
    private OperationsModels() {}
    public enum AppointmentStatus { BOOKED, ARRIVED, IN_CONSULTATION, COMPLETED, CANCELLED }
    public enum AppointmentSource { LOCAL, DOCTORALIA_MANUAL }
    public record Patient(UUID id, String reference, String fullName, LocalDate birthDate, String phone,
            String email, long version, boolean synthetic, Instant createdAt, Instant updatedAt) {}
    public record PatientInput(@NotBlank @Pattern(regexp="[A-Z0-9-]{2,40}") String reference,
            @NotBlank @Size(max=160) String fullName, @NotNull @PastOrPresent LocalDate birthDate,
            @Size(max=30) @Pattern(regexp="[0-9+() .-]{7,30}") String phone,
            @Email @Size(max=160) String email, @NotNull Boolean duplicateReviewed,
            @NotNull @AssertTrue Boolean synthetic) {
        public PatientInput { reference = code(reference); fullName = clean(fullName); phone = optional(phone); email = optional(email); }
    }
    public record PatientUpdate(@NotBlank @Pattern(regexp="[A-Z0-9-]{2,40}") String reference,
            @NotBlank @Size(max=160) String fullName, @NotNull @PastOrPresent LocalDate birthDate,
            @Size(max=30) @Pattern(regexp="[0-9+() .-]{7,30}") String phone,
            @Email @Size(max=160) String email, @NotNull Boolean duplicateReviewed,
            @NotNull @AssertTrue Boolean synthetic, @NotNull @Min(0) Long expectedVersion) {
        public PatientUpdate { reference = code(reference); fullName = clean(fullName); phone = optional(phone); email = optional(email); }
    }
    public record DuplicateCandidate(Patient patient, List<String> matchedOn) {}
    public record Appointment(UUID id, UUID patientId, String patientName, String patientReference,
            Instant startsAt, Instant endsAt, int durationMinutes, String service, String practitioner,
            String resource, AppointmentSource source, String externalReference, AppointmentStatus status,
            String cancellationReason, long version, Instant createdAt, Instant updatedAt) {}
    public record AppointmentInput(@NotNull UUID patientId, @NotNull Instant startsAt,
            @Min(5) @Max(480) int durationMinutes, @NotBlank @Size(max=120) String service,
            @NotBlank @Size(max=80) String practitioner, @NotBlank @Size(max=80) String resource,
            @NotNull AppointmentSource source, @Size(max=100) String externalReference) {
        public AppointmentInput { service = clean(service); practitioner = code(practitioner); resource = code(resource); externalReference = optional(externalReference); }
    }
    public record RescheduleInput(@NotNull Instant startsAt, @Min(5) @Max(480) int durationMinutes,
            @NotBlank @Size(max=120) String service, @NotBlank @Size(max=80) String practitioner,
            @NotBlank @Size(max=80) String resource, @NotNull AppointmentSource source,
            @Size(max=100) String externalReference, @NotNull @Min(0) Long expectedVersion) {
        public RescheduleInput { service = clean(service); practitioner = code(practitioner); resource = code(resource); externalReference = optional(externalReference); }
    }
    public record TransitionInput(@NotNull @Min(0) Long expectedVersion, @NotNull AppointmentStatus status,
            @Size(max=240) String reason) { public TransitionInput { reason = optional(reason); } }
    public record AppointmentEvent(UUID id, UUID appointmentId, UUID commandId, String action,
            AppointmentStatus fromStatus, AppointmentStatus toStatus, long version, String reason,
            String actor, Instant createdAt, Instant startsAt, Instant endsAt, String practitioner, String resource) {}
    static String clean(String value) { return value == null ? null : value.strip().replaceAll("\\s+", " "); }
    static String optional(String value) { var result = clean(value); return result == null || result.isEmpty() ? null : result; }
    static String code(String value) { return value == null ? null : clean(value).toUpperCase(Locale.ROOT); }
    static String normalizedName(String value) {
        return value == null ? null : Normalizer.normalize(code(value), Normalizer.Form.NFD).replaceAll("\\p{M}", "");
    }
}
