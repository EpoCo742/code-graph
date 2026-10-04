package com.acme.payments;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/payments")
public class PaymentsController {
    private final PaymentService paymentService;

    public PaymentsController(PaymentService paymentService) {
        this.paymentService = paymentService;
    }

    @PostMapping("/authorize")
    public Dtos.AuthorizationResult authorize(@RequestBody Dtos.AuthorizeRequest request) {
        return paymentService.authorize(request.customerId(), request.amount());
    }

    @PostMapping("/capture")
    public void capture(@RequestBody Dtos.CaptureRequest request) {
        paymentService.capture(request.authorizationId());
    }
}
