using System.Net.Http.Json;

namespace Notification.Processor;

public record Customer(string Id, string Name, string Email);

public class CustomersClient
{
    private readonly HttpClient _http;

    public CustomersClient(HttpClient http)
    {
        _http = http;
    }

    public Task<Customer?> GetCustomer(string id)
    {
        return _http.GetFromJsonAsync<Customer>($"/customers/{id}");
    }
}
