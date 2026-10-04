package com.acme.inventory;

import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

@Component
public class OrderCancelledListener {
    private final InventoryService inventoryService;

    public OrderCancelledListener(InventoryService inventoryService) {
        this.inventoryService = inventoryService;
    }

    @KafkaListener(topics = "order.cancelled", groupId = "inventory")
    public void onOrderCancelled(OrderCancelledEvent event) {
        for (OrderCancelledEvent.Line line : event.lines()) {
            inventoryService.release(line.sku(), line.qty());
        }
    }
}
