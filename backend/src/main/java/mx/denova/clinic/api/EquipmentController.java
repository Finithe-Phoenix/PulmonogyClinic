package mx.denova.clinic.api;

import static mx.denova.clinic.equipment.EquipmentModels.*;
import jakarta.validation.Valid;
import java.util.UUID;
import mx.denova.clinic.equipment.EquipmentService;
import mx.denova.clinic.inventory.InventoryModels.Page;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/equipment")
public class EquipmentController {
    private final EquipmentService equipment;
    public EquipmentController(EquipmentService equipment) { this.equipment = equipment; }

    @GetMapping("/assets")
    Page<Asset> assets(@RequestParam(required=false) String q, @RequestParam(required=false) AssetStatus status,
            @RequestParam(defaultValue="50") int limit, @RequestParam(defaultValue="0") int offset) {
        return equipment.assets(q, status, limit, offset);
    }

    @GetMapping("/assets/{id}") Asset asset(@PathVariable UUID id) { return equipment.asset(id); }

    @PostMapping("/assets") @ResponseStatus(HttpStatus.CREATED)
    Asset create(@RequestHeader("Idempotency-Key") UUID key, @RequestBody @Valid AssetInput input, Authentication auth) {
        return equipment.create(key, auth.getName(), input);
    }

    @PostMapping("/assets/{id}/status")
    Asset status(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key,
            @RequestBody @Valid StatusInput input, Authentication auth) {
        return equipment.changeStatus(key, auth.getName(), id, input);
    }

    @GetMapping("/assets/{id}/maintenance")
    Page<Maintenance> maintenance(@PathVariable UUID id, @RequestParam(defaultValue="50") int limit,
            @RequestParam(defaultValue="0") int offset) {
        return equipment.maintenance(id, limit, offset);
    }

    @PostMapping("/assets/{id}/maintenance") @ResponseStatus(HttpStatus.CREATED)
    Maintenance record(@PathVariable UUID id, @RequestHeader("Idempotency-Key") UUID key,
            @RequestBody @Valid MaintenanceInput input, Authentication auth) {
        return equipment.recordMaintenance(key, auth.getName(), id, input);
    }
}
