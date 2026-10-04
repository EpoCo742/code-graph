import { useEffect, useState } from 'react';
import { getOrderStatus } from '../api/ordersClient';

export function OrderStatusPage({ id }: { id: string }) {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    getOrderStatus(id).then((s) => setStatus(s.status));
  }, [id]);
  return <p>Status: {status}</p>;
}
