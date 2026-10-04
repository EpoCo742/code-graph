import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { OrdersCapabilityClient } from './clients/orders-capability.client';
import { CustomersClient } from './clients/customers.client';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersCapabilityClient, CustomersClient],
})
export class AppModule {}
