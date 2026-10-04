import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto';

@Controller('v1/orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async create(@Body() dto: CreateOrderDto) {
    return this.orders.placeOrder(dto);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.orders.getOrderView(id);
  }

  @Get(':id/status')
  async status(@Param('id') id: string) {
    return this.orders.getStatus(id);
  }
}
