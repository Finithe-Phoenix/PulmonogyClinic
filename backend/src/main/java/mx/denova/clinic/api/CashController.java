package mx.denova.clinic.api;

import static mx.denova.clinic.cash.CashModels.*;
import jakarta.validation.Valid;
import java.util.UUID;
import mx.denova.clinic.cash.CashService;
import mx.denova.clinic.inventory.InventoryModels.Page;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/cash")
public class CashController {
    private final CashService cash;
    public CashController(CashService cash) { this.cash = cash; }
    @GetMapping("/shifts")
    Page<Shift> shifts(@RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return cash.shifts(limit, offset); }
    @GetMapping("/shifts/{id}") Shift shift(@PathVariable UUID id) { return cash.shift(id); }
    @PostMapping("/shifts") @ResponseStatus(HttpStatus.CREATED)
    Shift open(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid ShiftInput input, Authentication auth) { return cash.open(key, auth.getName(), input); }
    @GetMapping("/shifts/{id}/payments")
    Page<Payment> payments(@PathVariable UUID id, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return cash.payments(id, limit, offset); }
    @PostMapping("/shifts/{id}/payments") @ResponseStatus(HttpStatus.CREATED)
    Payment pay(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid PaymentInput input, Authentication auth) { return cash.pay(key, auth.getName(), id, input); }
    @PostMapping("/payments/{id}/reverse")
    Payment reverse(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid ReverseInput input, Authentication auth) {
        if (auth.getAuthorities().stream().noneMatch(role -> role.getAuthority().equals("ROLE_ADMIN")))
            throw new ApiProblem(HttpStatus.FORBIDDEN, "CASH_REVERSAL_FORBIDDEN", "El reverso requiere autorización de administración.");
        return cash.reverse(key, auth.getName(), id, input);
    }
    @PostMapping("/shifts/{id}/close")
    Shift close(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid CloseInput input, Authentication auth) { return cash.close(key, auth.getName(), id, input); }
}
