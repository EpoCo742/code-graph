package com.acme.payments;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import java.util.Map;

@FeignClient(name = "stripe", url = "https://api.stripe.com")
public interface StripeClient {
    @PostMapping("/v1/payment_intents")
    Map<String, Object> createPaymentIntent(@RequestBody Map<String, Object> body);

    @PostMapping("/v1/payment_intents/{id}/capture")
    Map<String, Object> capture(@PathVariable("id") String id);
}
