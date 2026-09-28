package mx.denova.clinic.api;

import static mx.denova.clinic.inventory.InventoryModels.*;
import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import mx.denova.clinic.inventory.InventoryService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class InventoryController {
    private final InventoryService inventory;
    public InventoryController(InventoryService inventory) { this.inventory = inventory; }
    @GetMapping("/health") Map<String, String> health() { return Map.of("status", "up"); }
    @GetMapping("/api/v1/inventory/products") Page<Product> products(@RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return inventory.products(limit, offset); }
    @PostMapping("/api/v1/inventory/products") @ResponseStatus(HttpStatus.CREATED)
    Product createProduct(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid ProductInput input, Authentication auth) { return inventory.createProduct(key, actor(auth), input); }
    @GetMapping("/api/v1/inventory/lots") Page<Lot> lots(@RequestParam(required=false) UUID productId, @RequestParam(defaultValue="false") boolean availableOnly, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return inventory.lots(productId, availableOnly, limit, offset); }
    @GetMapping("/api/v1/inventory/lots/{id}") Lot lot(@PathVariable UUID id) { return inventory.lot(id); }
    @PostMapping("/api/v1/inventory/lots") @ResponseStatus(HttpStatus.CREATED)
    Lot createLot(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid LotInput input, Authentication auth) { return inventory.createLot(key, actor(auth), input); }
    @PostMapping("/api/v1/inventory/lots/{id}/movements") @ResponseStatus(HttpStatus.CREATED)
    Movement move(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid MovementInput input, Authentication auth) {
        return inventory.move(key, actor(auth), id, input, auth.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN")));
    }
    @PostMapping("/api/v1/inventory/lots/{id}/quarantine")
    Lot quarantine(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid QuarantineInput input, Authentication auth) { return inventory.quarantine(key, actor(auth), id, input); }
    @GetMapping("/api/v1/inventory/movements") Page<Movement> movements(@RequestParam(required=false) UUID lotId, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return inventory.movements(lotId, limit, offset); }
    @GetMapping("/api/v1/audit/events") Page<AuditEvent> events(@RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return inventory.events(limit, offset); }
    private String actor(Authentication auth) {
        String subject = auth.getName();
        if (subject == null || subject.isBlank() || subject.length() > 200)
            throw new ApiProblem(HttpStatus.UNAUTHORIZED, "INVALID_SUBJECT", "Se requiere una identidad válida.");
        return subject;
    }
}
