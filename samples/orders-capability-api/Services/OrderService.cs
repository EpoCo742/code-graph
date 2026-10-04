using Orders.Capability.Api.Clients;

namespace Orders.Capability.Api.Services;

public record CreateOrderRequest(string CustomerId, string Email, List<OrderLine> Lines);
public record OrderLine(string Sku, int Qty);
public record Order(string Id, string CustomerId, string Status, List<OrderLine> Lines);

public interface IOrderService
{
    Task<Order> Place(CreateOrderRequest request);
    Task<Order?> Get(string id);
    Task Cancel(string id);
}

public class OrderService : IOrderService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly PaymentsClient _payments;
    private readonly IOrderEvents _events;
    private readonly Dictionary<string, Order> _store = new();

    public OrderService(IHttpClientFactory httpClientFactory, PaymentsClient payments, IOrderEvents events)
    {
        _httpClientFactory = httpClientFactory;
        _payments = payments;
        _events = events;
    }

    public async Task<Order> Place(CreateOrderRequest request)
    {
        var inventory = _httpClientFactory.CreateClient("inventory");
        foreach (var line in request.Lines)
        {
            var response = await inventory.PostAsJsonAsync("/inventory/reserve", new { line.Sku, line.Qty });
            response.EnsureSuccessStatusCode();
        }
        await _payments.Authorize(request.CustomerId, request.Lines.Sum(l => l.Qty * 10m));
        var order = new Order(Guid.NewGuid().ToString("n"), request.CustomerId, "Placed", request.Lines);
        _store[order.Id] = order;
        await _events.OrderCreated(order);
        return order;
    }

    public Task<Order?> Get(string id)
    {
        return Task.FromResult(_store.TryGetValue(id, out var order) ? order : null);
    }

    public async Task Cancel(string id)
    {
        if (!_store.TryGetValue(id, out var order)) return;
        var inventory = _httpClientFactory.CreateClient("inventory");
        foreach (var line in order.Lines)
        {
            await inventory.PostAsJsonAsync("/inventory/release", new { line.Sku, line.Qty });
        }
        _store[id] = order with { Status = "Cancelled" };
        await _events.OrderCancelled(_store[id]);
    }
}
