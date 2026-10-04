package com.acme.inventory;

import java.util.List;

public record OrderCancelledEvent(String id, List<Line> lines) {
    public record Line(String sku, int qty) {}
}
