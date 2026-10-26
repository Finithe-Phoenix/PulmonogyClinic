package mx.denova.clinic.equipment;

import jakarta.validation.constraints.*;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Locale;
import java.util.UUID;

public final class EquipmentModels {
    private EquipmentModels() {}

    public enum AssetStatus { AVAILABLE, MAINTENANCE, OUT_OF_SERVICE }

    public record Asset(UUID id, String reference, String name, String location, String serialNumber,
            AssetStatus status, long version, LocalDate nextDueOn, Instant createdAt, Instant updatedAt) {}

    public record AssetInput(@NotBlank @Size(max=80) String reference,
            @NotBlank @Size(max=160) String name, @NotBlank @Size(max=160) String location,
            @Size(max=120) String serialNumber) {
        public AssetInput {
            reference = reference == null ? null : reference.strip().replaceAll("\\s+", " ").toUpperCase(Locale.ROOT);
            name = trim(name); location = trim(location); serialNumber = trim(serialNumber);
            if (serialNumber != null && serialNumber.isEmpty()) serialNumber = null;
        }
    }

    public record StatusInput(@NotNull AssetStatus status, @NotBlank @Size(max=160) String reason,
            @NotNull @PositiveOrZero Long expectedVersion) {
        public StatusInput { reason = trim(reason); }
    }

    public record MaintenanceInput(@NotNull LocalDate performedOn, LocalDate nextDueOn,
            @NotBlank @Size(max=1000) String description, @NotBlank @Size(max=160) String technician,
            @NotNull @PositiveOrZero Long expectedVersion) {
        public MaintenanceInput { description = trim(description); technician = trim(technician); }
    }

    public record Maintenance(UUID id, UUID assetId, LocalDate performedOn, LocalDate nextDueOn,
            String description, String technician, String actor, Instant createdAt, long assetVersion) {}

    private static String trim(String value) { return value == null ? null : value.strip(); }
}
