using Notification.Processor;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddHttpClient<CustomersClient>(c => c.BaseAddress = new Uri(builder.Configuration["Services:Customers:BaseUrl"]!));
builder.Services.AddHttpClient<EmailSender>();
builder.Services.AddHostedService<OrderCreatedWorker>();
builder.Services.AddHostedService<PaymentAuthorizedWorker>();
builder.Build().Run();
