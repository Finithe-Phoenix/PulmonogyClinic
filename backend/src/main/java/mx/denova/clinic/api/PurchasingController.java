package mx.denova.clinic.api;

import static mx.denova.clinic.purchasing.PurchasingModels.*;
import jakarta.validation.Valid;
import java.util.UUID;
import mx.denova.clinic.inventory.InventoryModels.Page;
import mx.denova.clinic.purchasing.PurchasingService;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/purchasing")
public class PurchasingController {
    private final PurchasingService purchasing;
    public PurchasingController(PurchasingService purchasing) { this.purchasing = purchasing; }
    @GetMapping("/suppliers") Page<Supplier> suppliers(@RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return purchasing.suppliers(limit, offset); }
    @PostMapping("/suppliers") @ResponseStatus(HttpStatus.CREATED)
    Supplier createSupplier(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid SupplierInput input, Authentication auth) { return purchasing.createSupplier(key, auth.getName(), input); }
    @GetMapping("/orders") Page<OrderSummary> orders(@RequestParam(required=false) UUID supplierId, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return purchasing.orders(supplierId, limit, offset); }
    @GetMapping("/orders/{id}") Order order(@PathVariable UUID id) { return purchasing.order(id); }
    @PostMapping("/orders") @ResponseStatus(HttpStatus.CREATED)
    Order createOrder(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid OrderInput input, Authentication auth) { return purchasing.createOrder(key, auth.getName(), input); }
    @PostMapping("/orders/{id}/receipts") @ResponseStatus(HttpStatus.CREATED)
    Receipt receive(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid ReceiptInput input, Authentication auth) { return purchasing.receive(key, auth.getName(), id, input); }
    @PostMapping("/orders/{id}/cancel")
    Order cancel(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid CancellationInput input, Authentication auth) { return purchasing.cancel(key, auth.getName(), id, input); }
    @GetMapping("/receipts") Page<Receipt> receipts(@RequestParam(required=false) UUID orderId, @RequestParam(required=false) UUID lotId, @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) { return purchasing.receipts(orderId, lotId, limit, offset); }
}
