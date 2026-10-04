import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class CustomersClient {
  private readonly http = axios.create({ baseURL: process.env.CUSTOMERS_API_URL });

  async getCustomer(id: string) {
    const res = await this.http.get(`/customers/${id}`);
    return res.data as { id: string; name: string; email: string };
  }
}
