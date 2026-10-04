import { Injectable } from '@nestjs/common';
import axios from 'axios';

const api = axios.create({ baseURL: process.env.ORDERS_CAP_URL });

@Injectable()
export class OrdersCapabilityClient {
  async createOrder(body: unknown) {
    const res = await api.post('/api/orders', body);
    return res.data as { id: string; status: string };
  }

  async getOrder(id: string) {
    const res = await api.get(`/api/orders/${id}`);
    return res.data as { id: string; status: string; customerId: string };
  }
}
