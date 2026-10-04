using Confluent.Kafka;
using System.Text.Json;
using Orders.Capability.Api.Messaging;

namespace Orders.Capability.Api.Services;

public interface IOrderEvents
{
    Task OrderCreated(Order order);
    Task OrderCancelled(Order order);
}

public class OrderEvents : IOrderEvents
{
    private readonly IProducer<string, string> _producer;

    public OrderEvents(IProducer<string, string> producer)
    {
        _producer = producer;
    }

    public async Task OrderCreated(Order order)
    {
        await _producer.ProduceAsync(Topics.OrderCreated, new Message<string, string> { Key = order.Id, Value = JsonSerializer.Serialize(order) });
    }

    public async Task OrderCancelled(Order order)
    {
        await _producer.ProduceAsync(Topics.OrderCancelled, new Message<string, string> { Key = order.Id, Value = JsonSerializer.Serialize(order) });
    }
}
