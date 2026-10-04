using System.Net.Http.Json;

namespace Orders.Capability.Api.Clients;

public class PaymentsClient
{
    private readonly HttpClient _http;

    public PaymentsClient(HttpClient http)
    {
        _http = http;
    }

    public async Task<string> Authorize(string customerId, decimal amount)
    {
        var response = await _http.PostAsJsonAsync("/payments/authorize", new { customerId, amount });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<AuthorizationResult>();
        return body!.AuthorizationId;
    }

    public async Task Capture(string authorizationId)
    {
        await _http.PostAsJsonAsync("/payments/capture", new { authorizationId });
    }

    private record AuthorizationResult(string AuthorizationId);
}
