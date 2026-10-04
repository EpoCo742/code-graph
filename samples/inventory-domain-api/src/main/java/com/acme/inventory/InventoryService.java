package com.acme.inventory;

import org.springframework.stereotype.Service;

@Service
public class InventoryService {
    private final WarehouseGateway warehouse;

    public InventoryService(WarehouseGateway warehouse) {
        this.warehouse = warehouse;
    }

    public StockLevel stockFor(String sku) {
        return new StockLevel(sku, warehouse.fetchStock(sku));
    }

    public void reserve(String sku, int qty) {
        warehouse.adjust(sku, -qty);
    }

    public void release(String sku, int qty) {
        warehouse.adjust(sku, qty);
    }
}
