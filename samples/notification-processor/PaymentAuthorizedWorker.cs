using RabbitMQ.Client;
using RabbitMQ.Client.Events;
using System.Text;
using System.Text.Json;

namespace Notification.Processor;

public class PaymentAuthorizedWorker : BackgroundService
{
    private const string Queue = "notifications.payment";
    private readonly CustomersClient _customers;
    private readonly EmailSender _email;

    public PaymentAuthorizedWorker(CustomersClient customers, EmailSender email)
    {
        _customers = customers;
        _email = email;
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var factory = new ConnectionFactory { HostName = "rabbitmq" };
        using var connection = factory.CreateConnection();
        using var channel = connection.CreateModel();
        channel.ExchangeDeclare(exchange: "payments", type: ExchangeType.Topic, durable: true);
        channel.QueueDeclare(queue: Queue, durable: true, exclusive: false, autoDelete: false);
        channel.QueueBind(queue: Queue, exchange: "payments", routingKey: "payment.authorized");

        var consumer = new EventingBasicConsumer(channel);
        consumer.Received += async (_, ea) =>
        {
            var payload = JsonSerializer.Deserialize<PaymentAuthorized>(Encoding.UTF8.GetString(ea.Body.ToArray()))!;
            await HandlePaymentAuthorized(payload);
        };
        channel.BasicConsume(queue: Queue, autoAck: true, consumer: consumer);
        return Task.CompletedTask;
    }

    private async Task HandlePaymentAuthorized(PaymentAuthorized payment)
    {
        var customer = await _customers.GetCustomer(payment.CustomerId);
        if (customer is null) return;
        await _email.Send(customer.Email, "Payment authorized", $"Authorization {payment.AuthorizationId} confirmed");
    }

    private record PaymentAuthorized(string AuthorizationId, string CustomerId);
}
