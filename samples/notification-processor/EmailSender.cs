using System.Net.Http.Json;

namespace Notification.Processor;

public class EmailSender
{
    private readonly HttpClient _http;

    public EmailSender(HttpClient http)
    {
        _http = http;
    }

    public async Task Send(string to, string subject, string body)
    {
        var payload = new { personalizations = new[] { new { to = new[] { new { email = to } } } }, subject, content = body };
        var response = await _http.PostAsJsonAsync("https://api.sendgrid.com/v3/mail/send", payload);
        response.EnsureSuccessStatusCode();
    }
}
