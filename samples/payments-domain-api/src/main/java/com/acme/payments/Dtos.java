package com.acme.payments;

import java.math.BigDecimal;

public class Dtos {
    public record AuthorizeRequest(String customerId, BigDecimal amount) {}
    public record CaptureRequest(String authorizationId) {}
    public record AuthorizationResult(String authorizationId) {}
}
