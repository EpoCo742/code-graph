package com.acme.inventory;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/inventory")
public class InventoryController {
    private final InventoryService inventoryService;

    public InventoryController(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @GetMapping("/{sku}")
    public StockLevel get(@PathVariable String sku) {
        return inventoryService.stockFor(sku);
    }

    @PostMapping("/reserve")
    public void reserve(@RequestBody ReservationRequest request) {
        inventoryService.reserve(request.sku(), request.qty());
    }

    @PostMapping("/release")
    public void release(@RequestBody ReservationRequest request) {
        inventoryService.release(request.sku(), request.qty());
    }
}
