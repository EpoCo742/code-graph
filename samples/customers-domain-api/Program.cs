using Customers.Domain.Api;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSingleton<CustomerRepository>();
var app = builder.Build();

var customers = app.MapGroup("/customers");
customers.MapGet("/{id}", (string id, CustomerRepository repo) =>
{
    var customer = repo.Find(id);
    return customer is null ? Results.NotFound() : Results.Ok(customer);
});
customers.MapPut("/{id}", (string id, Customer customer, CustomerRepository repo) =>
{
    repo.Upsert(id, customer);
    return Results.NoContent();
});
app.MapGet("/health", () => Results.Ok());
app.Run();
