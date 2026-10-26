package mx.denova.clinic.api;

import static mx.denova.clinic.operations.OperationsModels.*;
import jakarta.validation.Valid;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import mx.denova.clinic.inventory.InventoryModels.Page;
import mx.denova.clinic.operations.OperationsService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/operations")
public class OperationsController {
    private final OperationsService operations;
    public OperationsController(OperationsService operations) { this.operations = operations; }

    @GetMapping("/patients") Page<Patient> patients(@RequestParam(required=false) String q, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return operations.patients(q, limit, offset); }
    @GetMapping("/patients/duplicates") Page<DuplicateCandidate> duplicates(@RequestParam(defaultValue="") String fullName, @RequestParam(required=false) LocalDate birthDate, @RequestParam(required=false) String phone, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return operations.duplicates(fullName, birthDate, phone, limit, offset); }
    @GetMapping("/patients/{id}") Patient patient(@PathVariable UUID id) { return operations.patient(id); }
    @PostMapping("/patients") @ResponseStatus(HttpStatus.CREATED)
    Patient createPatient(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid PatientInput input, Authentication auth) { return operations.createPatient(key, auth.getName(), input); }
    @PostMapping("/patients/{id}/update")
    Patient updatePatient(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid PatientUpdate input, Authentication auth) { return operations.updatePatient(key, auth.getName(), id, input); }

    @GetMapping("/appointments") Page<Appointment> appointments(@RequestParam(required=false) Instant from, @RequestParam(required=false) Instant to, @RequestParam(required=false) AppointmentStatus status, @RequestParam(required=false) UUID patientId, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return operations.appointments(from, to, status, patientId, limit, offset); }
    @GetMapping("/appointments/{id}") Appointment appointment(@PathVariable UUID id) { return operations.appointment(id); }
    @GetMapping("/appointments/{id}/history") Page<AppointmentEvent> history(@PathVariable UUID id, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return operations.history(id, limit, offset); }
    @PostMapping("/appointments") @ResponseStatus(HttpStatus.CREATED)
    Appointment createAppointment(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid AppointmentInput input, Authentication auth) { return operations.createAppointment(key, auth.getName(), input); }
    @PostMapping("/appointments/{id}/reschedule")
    Appointment reschedule(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid RescheduleInput input, Authentication auth) { return operations.reschedule(key, auth.getName(), id, input); }
    @PostMapping("/appointments/{id}/transition")
    Appointment transition(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid TransitionInput input, Authentication auth) {
        if ((input.status() == AppointmentStatus.IN_CONSULTATION || input.status() == AppointmentStatus.COMPLETED)
                && auth.getAuthorities().stream().noneMatch(a -> a.getAuthority().equals("ROLE_ADMIN") || a.getAuthority().equals("ROLE_MEDICO")))
            throw new ApiProblem(HttpStatus.FORBIDDEN, "ROLE_REQUIRED", "Solo el personal médico o administrador puede iniciar y finalizar una consulta.");
        return operations.transition(key, auth.getName(), id, input);
    }
}
