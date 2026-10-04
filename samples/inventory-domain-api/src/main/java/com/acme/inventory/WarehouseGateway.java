package com.acme.inventory;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;
import java.util.Map;

@Component
public class WarehouseGateway {
    private final RestTemplate restTemplate;

    @Value("${wms.base-url:https://api.wms-vendor.com}")
    private String wmsBaseUrl;

    public WarehouseGateway(RestTemplate restTemplate) {
        this.restTemplate = restTemplate;
    }

    public int fetchStock(String sku) {
        Map<?, ?> body = restTemplate.getForObject(wmsBaseUrl + "/v2/stock/" + sku, Map.class);
        return body == null ? 0 : (Integer) body.get("available");
    }

    public void adjust(String sku, int delta) {
        restTemplate.postForObject("https://api.wms-vendor.com/v2/stock/" + sku + "/adjust", Map.of("delta", delta), Void.class);
    }
}
