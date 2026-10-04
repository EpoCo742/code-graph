namespace Customers.Domain.Api;

public record Customer(string Id, string Name, string Email);

public class CustomerRepository
{
    private readonly Dictionary<string, Customer> _customers = new();

    public Customer? Find(string id) => _customers.TryGetValue(id, out var c) ? c : null;

    public void Upsert(string id, Customer customer) => _customers[id] = customer with { Id = id };
}
