export interface CreateOrderDto {
  customerId: string;
  lines: { sku: string; qty: number }[];
}
