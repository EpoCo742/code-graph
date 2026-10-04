using Confluent.Kafka;
using System.Text.Json;

namespace Notification.Processor;

public class OrderCreatedWorker : BackgroundService
{
    private readonly CustomersClient _customers;
    private readonly EmailSender _email;

    public OrderCreatedWorker(CustomersClient customers, EmailSender email)
    {
        _customers = customers;
        _email = email;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var consumer = new ConsumerBuilder<string, string>(new ConsumerConfig { BootstrapServers = "kafka:9092", GroupId = "notifications" }).Build();
        consumer.Subscribe("order.created");
        while (!stoppingToken.IsCancellationRequested)
        {
            var result = consumer.Consume(stoppingToken);
            var order = JsonSerializer.Deserialize<OrderCreated>(result.Message.Value)!;
            await HandleOrderCreated(order);
        }
    }

    private async Task HandleOrderCreated(OrderCreated order)
    {
        var customer = await _customers.GetCustomer(order.CustomerId);
        if (customer is null) return;
        await _email.Send(customer.Email, "Order received", $"Thanks for order {order.Id}");
    }

    private record OrderCreated(string Id, string CustomerId);
}
