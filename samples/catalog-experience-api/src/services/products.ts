const PRODUCTS_BASE = process.env.PRODUCTS_API_URL ?? 'http://localhost:9000';

export async function fetchProducts() {
  const res = await fetch(`${PRODUCTS_BASE}/products`);
  return (await res.json()) as { id: string; name: string; price: number }[];
}

export async function fetchProduct(id: string) {
  const res = await fetch(`${PRODUCTS_BASE}/products/${id}`);
  if (res.status === 404) return undefined;
  return (await res.json()) as { id: string; name: string; price: number };
}
