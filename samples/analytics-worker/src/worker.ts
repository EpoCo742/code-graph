import { Kafka } from 'kafkajs';
import { ORDER_CANCELLED, ORDER_CREATED, ORDER_METRICS } from './topics';
import { computeMetrics } from './metrics';

const kafka = new Kafka({ clientId: 'analytics-worker', brokers: ['kafka:9092'] });
const consumer = kafka.consumer({ groupId: 'analytics' });
const producer = kafka.producer();

export async function start() {
  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topics: [ORDER_CREATED, ORDER_CANCELLED], fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const event = JSON.parse(message.value?.toString() ?? '{}');
      const metrics = computeMetrics(topic, event);
      await producer.send({ topic: ORDER_METRICS, messages: [{ key: event.id, value: JSON.stringify(metrics) }] });
    },
  });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
