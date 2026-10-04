import { Injectable } from '@nestjs/common';
import { OrdersCapabilityClient } from '../clients/orders-capability.client';
import { CustomersClient } from '../clients/customers.client';
import { CreateOrderDto } from './dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly capability: OrdersCapabilityClient,
    private readonly customers: CustomersClient,
  ) {}

  async placeOrder(dto: CreateOrderDto) {
    const customer = await this.customers.getCustomer(dto.customerId);
    const order = await this.capability.createOrder({ ...dto, email: customer.email });
    return { id: order.id, status: order.status };
  }

  async getOrderView(id: string) {
    const order = await this.capability.getOrder(id);
    const customer = await this.customers.getCustomer(order.customerId);
    return { ...order, customerName: customer.name };
  }

  async getStatus(id: string) {
    const order = await this.capability.getOrder(id);
    return { status: order.status };
  }
}
