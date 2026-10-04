import { useState } from 'react';
import { placeOrder } from '../api/ordersClient';

export default function CheckoutPage({ customerId }: { customerId: string }) {
  const [orderId, setOrderId] = useState<string>();
  const submit = async () => {
    const result = await placeOrder({ customerId, lines: [{ sku: 'SKU-1', qty: 1 }] });
    setOrderId(result.id);
  };
  return (
    <div>
      <button onClick={submit}>Place order</button>
      {orderId && <p>Order {orderId} placed</p>}
    </div>
  );
}
