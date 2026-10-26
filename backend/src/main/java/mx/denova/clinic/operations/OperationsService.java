package mx.denova.clinic.operations;

import static mx.denova.clinic.operations.OperationsModels.*;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import mx.denova.clinic.api.ApiProblem;
import mx.denova.clinic.equipment.EquipmentService;
import mx.denova.clinic.inventory.CommandService;
import mx.denova.clinic.inventory.InventoryModels.Page;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

@Service
public class OperationsService {
    private final JdbcTemplate jdbc;
    private final CommandService commands;
    private final Clock clock;
    private final EquipmentService equipment;
    private static final String APPOINTMENT_SELECT = "SELECT a.*, p.full_name patient_name, p.reference patient_reference FROM operation_appointment a JOIN operation_patient p ON p.id = a.patient_id";
    private static final RowMapper<Patient> PATIENT = (r,n) -> new Patient(r.getObject("id", UUID.class), r.getString("reference"), r.getString("full_name"), r.getObject("birth_date", LocalDate.class), r.getString("phone"), r.getString("email"), r.getLong("version"), r.getBoolean("synthetic"), r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getObject("updated_at", OffsetDateTime.class).toInstant());
    private static final RowMapper<Appointment> APPOINTMENT = (r,n) -> new Appointment(r.getObject("id", UUID.class), r.getObject("patient_id", UUID.class), r.getString("patient_name"), r.getString("patient_reference"), r.getObject("starts_at", OffsetDateTime.class).toInstant(), r.getObject("ends_at", OffsetDateTime.class).toInstant(), r.getInt("duration_minutes"), r.getString("service"), r.getString("practitioner"), r.getString("resource"), AppointmentSource.valueOf(r.getString("source")), r.getString("external_reference"), AppointmentStatus.valueOf(r.getString("status")), r.getString("cancellation_reason"), r.getLong("version"), r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getObject("updated_at", OffsetDateTime.class).toInstant());
    private static final RowMapper<AppointmentEvent> EVENT = (r,n) -> new AppointmentEvent(r.getObject("id", UUID.class), r.getObject("appointment_id", UUID.class), r.getObject("command_id", UUID.class), r.getString("action"), r.getString("from_status") == null ? null : AppointmentStatus.valueOf(r.getString("from_status")), AppointmentStatus.valueOf(r.getString("to_status")), r.getLong("version"), r.getString("reason"), r.getString("actor"), r.getObject("created_at", OffsetDateTime.class).toInstant(), r.getObject("starts_at", OffsetDateTime.class).toInstant(), r.getObject("ends_at", OffsetDateTime.class).toInstant(), r.getString("practitioner"), r.getString("resource"));

    public OperationsService(JdbcTemplate jdbc, CommandService commands, Clock clock, EquipmentService equipment) { this.jdbc = jdbc; this.commands = commands; this.clock = clock; this.equipment = equipment; }

    public Page<Patient> patients(String q, int limit, int offset) {
        pageBounds(limit, offset);
        if (q != null && q.length() > 160) throw invalid("La búsqueda admite hasta 160 caracteres.");
        String term = "%" + escaped(normalizedName(q == null ? "" : q)) + "%";
        return new Page<>(jdbc.query("SELECT * FROM operation_patient WHERE normalized_name LIKE ? ESCAPE '!' OR reference LIKE ? ESCAPE '!' ORDER BY normalized_name, reference LIMIT ? OFFSET ?", PATIENT, term, term, limit, offset), limit, offset);
    }
    public Patient patient(UUID id) { return patient(id, false); }
    private Patient patient(UUID id, boolean lock) {
        var found = jdbc.query("SELECT * FROM operation_patient WHERE id = ?" + (lock ? " FOR UPDATE" : ""), PATIENT, id);
        if (found.isEmpty()) throw ApiProblem.missing();
        return found.getFirst();
    }
    public Page<DuplicateCandidate> duplicates(String fullName, LocalDate birthDate, String phone, int limit, int offset) {
        pageBounds(limit, offset);
        if (fullName == null || fullName.isBlank() || fullName.length() > 160 || (phone != null && phone.length() > 30)) throw invalid("Indica un nombre para revisar coincidencias.");
        String name = normalizedName(fullName), normalizedPhone = phoneDigits(phone);
        var result = jdbc.query("""
            SELECT * FROM operation_patient WHERE normalized_name = ?
            OR (birth_date = ? AND regexp_replace(phone, '[^0-9]', '', 'g') = ? AND ? <> '')
            ORDER BY normalized_name, reference LIMIT ? OFFSET ?
            """, PATIENT, name, birthDate, normalizedPhone, normalizedPhone, limit, offset);
        return new Page<>(result.stream().map(p -> {
            var matches = new ArrayList<String>();
            if (normalizedName(p.fullName()).equals(name)) matches.add("NAME");
            if (birthDate != null && birthDate.equals(p.birthDate())) matches.add("BIRTH_DATE");
            if (!normalizedPhone.isEmpty() && normalizedPhone.equals(phoneDigits(p.phone()))) matches.add("PHONE");
            return new DuplicateCandidate(p, List.copyOf(matches));
        }).toList(), limit, offset);
    }
    public Patient createPatient(UUID key, String actor, PatientInput input) {
        return commands.execute(key, actor, "CREATE_PATIENT", input, Patient.class, () -> {
            patientRegistryLock();
            validateBirthDate(input.birthDate());
            checkDuplicates(null, input.fullName(), input.birthDate(), input.phone(), input.duplicateReviewed());
            UUID id = UUID.randomUUID();
            jdbc.update("INSERT INTO operation_patient(id, reference, full_name, normalized_name, birth_date, phone, email, synthetic) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, input.reference(), input.fullName(), normalizedName(input.fullName()), input.birthDate(), input.phone(), input.email(), input.synthetic());
            audit(key, "PATIENT_CREATED", id, actor, "Alta administrativa sintética");
            return patient(id);
        });
    }
    public Patient updatePatient(UUID key, String actor, UUID id, PatientUpdate input) {
        return commands.execute(key, actor, "UPDATE_PATIENT:" + id, input, Patient.class, () -> {
            patientRegistryLock();
            Patient current = patient(id, true);
            expectedVersion(current.version(), input.expectedVersion());
            validateBirthDate(input.birthDate());
            checkDuplicates(id, input.fullName(), input.birthDate(), input.phone(), input.duplicateReviewed());
            jdbc.update("UPDATE operation_patient SET reference = ?, full_name = ?, normalized_name = ?, birth_date = ?, phone = ?, email = ?, version = version + 1, updated_at = now() WHERE id = ?", input.reference(), input.fullName(), normalizedName(input.fullName()), input.birthDate(), input.phone(), input.email(), id);
            audit(key, "PATIENT_UPDATED", id, actor, "Datos administrativos sintéticos actualizados");
            return patient(id);
        });
    }
    public Page<Appointment> appointments(Instant from, Instant to, AppointmentStatus status, UUID patientId, int limit, int offset) {
        pageBounds(limit, offset);
        if (from != null && (from.isBefore(Instant.parse("1900-01-01T00:00:00Z")) || from.isAfter(Instant.parse("9999-01-01T00:00:00Z")))) throw invalid("Revisa el intervalo de la agenda.");
        if ((from == null) != (to == null) || (from != null && (!from.isBefore(to) || to.isAfter(from.plusSeconds(93L * 86400))))) throw invalid("El intervalo de agenda debe ser de hasta 93 días, con inicio y fin.");
        String sql = APPOINTMENT_SELECT + " WHERE 1=1";
        var args = new ArrayList<Object>();
        if (from != null) { sql += " AND a.starts_at < ? AND a.ends_at > ?"; args.add(timestamp(to)); args.add(timestamp(from)); }
        if (status != null) { sql += " AND a.status = ?"; args.add(status.name()); }
        if (patientId != null) { sql += " AND a.patient_id = ?"; args.add(patientId); }
        sql += " ORDER BY a.starts_at, a.id LIMIT ? OFFSET ?";
        args.add(limit); args.add(offset);
        return new Page<>(jdbc.query(sql, APPOINTMENT, args.toArray()), limit, offset);
    }
    public Appointment appointment(UUID id) { return appointment(id, false); }
    private Appointment appointment(UUID id, boolean lock) {
        var found = jdbc.query(APPOINTMENT_SELECT + " WHERE a.id = ?" + (lock ? " FOR UPDATE OF a" : ""), APPOINTMENT, id);
        if (found.isEmpty()) throw ApiProblem.missing();
        return found.getFirst();
    }
    public Appointment createAppointment(UUID key, String actor, AppointmentInput input) {
        return commands.execute(key, actor, "CREATE_APPOINTMENT", input, Appointment.class, () -> {
            scheduleLock();
            patient(input.patientId());
            Instant ends = validateSlot(input.startsAt(), input.durationMinutes(), input.source(), input.externalReference());
            equipment.assertResourceAvailable(input.resource());
            checkOverlap(null, input.patientId(), input.startsAt(), ends, input.practitioner(), input.resource());
            UUID id = UUID.randomUUID();
            jdbc.update("""
                INSERT INTO operation_appointment(id, patient_id, starts_at, ends_at, duration_minutes, service, practitioner, resource, source, external_reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, input.patientId(), timestamp(input.startsAt()), timestamp(ends), input.durationMinutes(), input.service(), input.practitioner(), input.resource(), input.source().name(), input.externalReference());
            event(key, id, actor, "APPOINTMENT_BOOKED", null, AppointmentStatus.BOOKED, 0, "Cita registrada; agenda conciliada manualmente");
            return appointment(id);
        });
    }
    public Appointment reschedule(UUID key, String actor, UUID id, RescheduleInput input) {
        return commands.execute(key, actor, "RESCHEDULE_APPOINTMENT:" + id, input, Appointment.class, () -> {
            scheduleLock();
            Appointment current = appointment(id, true);
            expectedVersion(current.version(), input.expectedVersion());
            if (current.status() != AppointmentStatus.BOOKED) throw ApiProblem.conflict("INVALID_TRANSITION", "Solo puedes reprogramar una cita pendiente de llegada.");
            Instant ends = validateSlot(input.startsAt(), input.durationMinutes(), input.source(), input.externalReference());
            equipment.assertResourceAvailable(input.resource());
            checkOverlap(id, current.patientId(), input.startsAt(), ends, input.practitioner(), input.resource());
            jdbc.update("""
                UPDATE operation_appointment SET starts_at = ?, ends_at = ?, duration_minutes = ?, service = ?, practitioner = ?, resource = ?, source = ?, external_reference = ?, version = version + 1, updated_at = now() WHERE id = ?
                """, timestamp(input.startsAt()), timestamp(ends), input.durationMinutes(), input.service(), input.practitioner(), input.resource(), input.source().name(), input.externalReference(), id);
            event(key, id, actor, "APPOINTMENT_RESCHEDULED", current.status(), current.status(), current.version()+1, "Cita reprogramada");
            return appointment(id);
        });
    }
    public Appointment transition(UUID key, String actor, UUID id, TransitionInput input) {
        return commands.execute(key, actor, "TRANSITION_APPOINTMENT:" + id, input, Appointment.class, () -> {
            scheduleLock();
            Appointment current = appointment(id, true);
            expectedVersion(current.version(), input.expectedVersion());
            boolean permitted = switch (current.status()) {
                case BOOKED -> input.status() == AppointmentStatus.ARRIVED || input.status() == AppointmentStatus.CANCELLED;
                case ARRIVED -> input.status() == AppointmentStatus.IN_CONSULTATION || input.status() == AppointmentStatus.CANCELLED;
                case IN_CONSULTATION -> input.status() == AppointmentStatus.COMPLETED;
                case COMPLETED, CANCELLED -> false;
            };
            if (!permitted) throw ApiProblem.conflict("INVALID_TRANSITION", "La cita cambió o esa transición no está permitida.");
            if (input.status() == AppointmentStatus.IN_CONSULTATION) {
                equipment.assertResourceAvailable(current.resource());
                Integer active = jdbc.queryForObject("SELECT count(*) FROM operation_appointment WHERE status = 'IN_CONSULTATION' AND id <> ? AND (patient_id = ? OR practitioner = ? OR resource = ?)", Integer.class, id, current.patientId(), current.practitioner(), current.resource());
                if (active != null && active > 0) throw ApiProblem.conflict("SCHEDULE_CONFLICT", "El paciente, profesional o recurso sigue en otra consulta. Finaliza esa atención antes de iniciar.");
            }
            if (input.status() == AppointmentStatus.CANCELLED && input.reason() == null) throw invalid("Indica el motivo de cancelación.");
            String reason = input.reason() == null ? "Estado administrativo de cita actualizado" : input.reason();
            jdbc.update("UPDATE operation_appointment SET status = ?, cancellation_reason = ?, version = version + 1, updated_at = now() WHERE id = ?", input.status().name(), input.status() == AppointmentStatus.CANCELLED ? reason : null, id);
            event(key, id, actor, "APPOINTMENT_" + input.status(), current.status(), input.status(), current.version()+1, reason);
            return appointment(id);
        });
    }
    public Page<AppointmentEvent> history(UUID id, int limit, int offset) {
        pageBounds(limit, offset);
        appointment(id);
        return new Page<>(jdbc.query("SELECT * FROM operation_appointment_event WHERE appointment_id = ? ORDER BY version, id LIMIT ? OFFSET ?", EVENT, id, limit, offset), limit, offset);
    }
    private void checkDuplicates(UUID excluded, String fullName, LocalDate birthDate, String phone, Boolean reviewed) {
        if (Boolean.TRUE.equals(reviewed)) return;
        String normalizedPhone = phoneDigits(phone);
        Integer count = jdbc.queryForObject("""
            SELECT count(*) FROM operation_patient WHERE (?::uuid IS NULL OR id <> ?::uuid)
            AND (normalized_name = ? OR (birth_date = ? AND regexp_replace(phone, '[^0-9]', '', 'g') = ? AND ? <> ''))
            """, Integer.class, excluded, excluded, normalizedName(fullName), birthDate, normalizedPhone, normalizedPhone);
        if (count != null && count > 0) throw ApiProblem.conflict("POSSIBLE_DUPLICATE", "Hay posibles coincidencias. Revisa nombre, fecha de nacimiento y contacto antes de confirmar un registro independiente.");
    }
    private void checkOverlap(UUID excluded, UUID patientId, Instant starts, Instant ends, String practitioner, String resource) {
        Integer count = jdbc.queryForObject("""
            SELECT count(*) FROM operation_appointment WHERE status <> 'CANCELLED'
            AND (?::uuid IS NULL OR id <> ?::uuid) AND starts_at < ? AND ends_at > ?
            AND (patient_id = ? OR practitioner = ? OR resource = ?)
            """, Integer.class, excluded, excluded, timestamp(ends), timestamp(starts), patientId, practitioner, resource);
        if (count != null && count > 0) throw ApiProblem.conflict("SCHEDULE_CONFLICT", "El paciente, profesional o recurso ya tiene una cita en ese horario. Actualiza la agenda y elige otro horario.");
    }
    // Serialize all schedule mutations across JVMs; every transaction takes this before locking an appointment.
    // This low-volume clinic has one agenda. The lock avoids phantom overlap races without an extension requirement.
    private void scheduleLock() { jdbc.queryForList("SELECT pg_advisory_xact_lock(72411001)"); }
    private void patientRegistryLock() { jdbc.queryForList("SELECT pg_advisory_xact_lock(72411002)"); }
    private Instant validateSlot(Instant starts, int minutes, AppointmentSource source, String reference) {
        if (starts.isBefore(clock.instant().minusSeconds(86400)) || starts.isAfter(clock.instant().plusSeconds(366L * 86400 * 2))) throw invalid("La cita debe estar entre ayer y los próximos dos años.");
        if (source == AppointmentSource.DOCTORALIA_MANUAL && reference == null) throw invalid("Agrega la referencia para conciliar manualmente la cita de Doctoralia.");
        return starts.plusSeconds(minutes * 60L);
    }
    private void validateBirthDate(LocalDate birthDate) {
        if (birthDate.isAfter(LocalDate.now(clock)) || birthDate.isBefore(LocalDate.now(clock).minusYears(130))) throw invalid("Revisa la fecha de nacimiento.");
    }
    private void expectedVersion(long actual, Long expected) {
        if (expected == null || actual != expected) throw ApiProblem.conflict("VERSION_CONFLICT", "Otra persona actualizó este registro. Actualiza los datos antes de volver a guardar.");
    }
    private void event(UUID command, UUID id, String actor, String action, AppointmentStatus from, AppointmentStatus to, long version, String reason) {
        jdbc.update("INSERT INTO operation_appointment_event(id, appointment_id, command_id, action, from_status, to_status, version, reason, actor, starts_at, ends_at, practitioner, resource) SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, starts_at, ends_at, practitioner, resource FROM operation_appointment WHERE id = ?", UUID.randomUUID(), command, action, from == null ? null : from.name(), to.name(), version, reason, actor, id);
        audit(command, action, id, actor, reason);
    }
    private void audit(UUID command, String action, UUID id, String actor, String reason) { jdbc.update("INSERT INTO audit_event(command_id, action, entity_id, actor, reason) VALUES (?, ?, ?, ?, ?)", command, action, id, actor, reason); }
    private static OffsetDateTime timestamp(Instant value) { return value.atOffset(ZoneOffset.UTC); }
    private static String phoneDigits(String value) { return value == null ? "" : value.replaceAll("[^0-9]", ""); }
    private static String escaped(String value) { return value.replace("!", "!!").replace("%", "!%").replace("_", "!_"); }
    private static void pageBounds(int limit, int offset) { if (limit < 1 || limit > 100 || offset < 0 || offset > 1000000) throw invalid("Usa un límite entre 1 y 100 y un desplazamiento entre 0 y 1000000."); }
    private static ApiProblem invalid(String message) { return new ApiProblem(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message); }
}
