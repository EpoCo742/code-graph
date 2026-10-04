using Confluent.Kafka;
using Orders.Capability.Api.Clients;
using Orders.Capability.Api.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddControllers();
builder.Services.AddHttpClient("inventory", c => c.BaseAddress = new Uri(builder.Configuration["Services:Inventory:BaseUrl"]!));
builder.Services.AddHttpClient<PaymentsClient>(c => c.BaseAddress = new Uri(builder.Configuration["Services:Payments:BaseUrl"]!));
builder.Services.AddSingleton<IProducer<string, string>>(_ => new ProducerBuilder<string, string>(new ProducerConfig { BootstrapServers = "kafka:9092" }).Build());
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<IOrderEvents, OrderEvents>();

var app = builder.Build();
app.MapControllers();
app.MapGet("/health", () => Results.Ok("healthy"));
app.Run();
