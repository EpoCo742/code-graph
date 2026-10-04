export function computeMetrics(topic: string, event: { id: string; lines?: { qty: number }[] }) {
  const units = (event.lines ?? []).reduce((sum, l) => sum + l.qty, 0);
  return { orderId: event.id, topic, units, at: new Date().toISOString() };
}
