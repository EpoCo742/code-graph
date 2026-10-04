import axios from 'axios';

export const catalogApi = axios.create({
  baseURL: import.meta.env.VITE_CATALOG_EXP_URL,
  timeout: 5000,
});

export interface Product {
  id: string;
  name: string;
  price: number;
}

export async function listProducts(): Promise<Product[]> {
  const res = await catalogApi.get<Product[]>('/v1/catalog/products');
  return res.data;
}

export async function getProduct(id: string): Promise<Product> {
  const res = await catalogApi.get<Product>(`/v1/catalog/products/${id}`);
  return res.data;
}
