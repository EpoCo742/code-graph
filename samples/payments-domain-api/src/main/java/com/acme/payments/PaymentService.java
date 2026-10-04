package com.acme.payments;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Service;
import java.math.BigDecimal;
import java.util.Map;

@Service
public class PaymentService {
    private static final String PAYMENTS_EXCHANGE = "payments";
    private final StripeClient stripeClient;
    private final RabbitTemplate rabbitTemplate;

    public PaymentService(StripeClient stripeClient, RabbitTemplate rabbitTemplate) {
        this.stripeClient = stripeClient;
        this.rabbitTemplate = rabbitTemplate;
    }

    public Dtos.AuthorizationResult authorize(String customerId, BigDecimal amount) {
        Map<String, Object> charge = stripeClient.createPaymentIntent(Map.of("customer", customerId, "amount", amount));
        String id = (String) charge.get("id");
        rabbitTemplate.convertAndSend(PAYMENTS_EXCHANGE, "payment.authorized", Map.of("authorizationId", id, "customerId", customerId));
        return new Dtos.AuthorizationResult(id);
    }

    public void capture(String authorizationId) {
        stripeClient.capture(authorizationId);
        rabbitTemplate.convertAndSend(PAYMENTS_EXCHANGE, "payment.captured", Map.of("authorizationId", authorizationId));
    }
}
