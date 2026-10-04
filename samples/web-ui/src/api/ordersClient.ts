const ORDERS_BASE = import.meta.env.VITE_ORDERS_EXP_URL;

export interface NewOrder {
  customerId: string;
  lines: { sku: string; qty: number }[];
}

export async function placeOrder(order: NewOrder): Promise<{ id: string }> {
  const res = await fetch(`${ORDERS_BASE}/v1/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(order),
  });
  if (!res.ok) throw new Error('failed to place order');
  return res.json();
}

export async function getOrderStatus(id: string): Promise<{ status: string }> {
  const res = await fetch(`${import.meta.env.VITE_ORDERS_EXP_URL}/v1/orders/${id}/status`);
  return res.json();
}
