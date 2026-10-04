import type { ArgValue, CodeUnit } from '../model.js';
import type { Plugin, PluginContext } from './types.js';
import { receiverType, splitList } from './util.js';

function str(ctx: PluginContext, unit: CodeUnit, a: ArgValue | undefined): string | undefined {
  if (!a) return undefined;
  const r = ctx.resolveString(a, unit);
  return r?.value;
}

function named(inv: { args: ArgValue[] }, name: string, position: number): ArgValue | undefined {
  return inv.args.find((a) => a.name === name) ?? (inv.args.every((a) => !a.name) ? inv.args[position] : undefined);
}

export const rabbitmq: Plugin = {
  name: 'rabbitmq',
  detect(repo) {
    return (
      [...repo.dependencies].some((d) => /rabbit|amqp/i.test(d)) ||
      repo.units.some((u) => u.attrs.some((a) => a.name === 'RabbitListener') || u.invocations.some((i) => /^(BasicConsume|BasicPublish|QueueBind|convertAndSend|sendToQueue|bindQueue|assertQueue)$/.test(i.method)))
    );
  },
  apply(ctx) {
    const { repo } = ctx;
    // Bindings: queue -> { exchange, routingKey }
    const bindings = new Map<string, { exchange?: string; routingKey?: string }>();
    for (const unit of repo.units) {
      for (const inv of unit.invocations) {
        if (inv.method === 'QueueBind' || inv.method === 'bindQueue' || inv.method === 'queueBind') {
          const q = str(ctx, unit, named(inv, 'queue', 0));
          const ex = str(ctx, unit, named(inv, 'exchange', 1)) ?? str(ctx, unit, named(inv, 'source', 1));
          const key = str(ctx, unit, named(inv, 'routingKey', 2)) ?? str(ctx, unit, named(inv, 'pattern', 2));
          if (q) bindings.set(q, { exchange: ex, routingKey: key });
        }
      }
      // spring-amqp @QueueBinding
      for (const a of unit.attrs.filter((x) => x.name === 'RabbitListener')) {
        const raw = a.raw;
        const q = /@Queue\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/.exec(raw)?.[1];
        const ex = /@Exchange\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/.exec(raw)?.[1];
        const key = /key\s*=\s*(?:\{\s*)?"([^"]+)"/.exec(raw)?.[1];
        if (q) bindings.set(q, { exchange: ex, routingKey: key });
      }
    }

    for (const unit of repo.units) {
      const lang = repo.files.find((f) => f.path === unit.file)?.language;
      for (const a of unit.attrs.filter((x) => x.name === 'RabbitListener')) {
        const queues = splitList(a.named.queues ?? a.args[0]);
        const bound = /@Queue\s*\(\s*(?:value\s*=\s*)?"([^"]+)"/.exec(a.raw)?.[1];
        for (const q of queues.length ? queues : bound ? [bound] : []) {
          const b = bindings.get(q);
          ctx.addConsumer({ broker: 'rabbitmq', topic: q, exchange: b?.exchange, routingKey: b?.routingKey, handler: unit.id, location: ctx.loc(unit) });
        }
      }
      for (const inv of unit.invocations) {
        const receiver = inv.receiverChain[inv.receiverChain.length - 1];
        const rtype = receiver ? receiverType(repo, unit, receiver) : undefined;
        const amqpish = /channel|rabbit|amqp|model|bus/i.test(receiver ?? '') || /IModel|IChannel|RabbitTemplate|AmqpTemplate|Channel/.test(rtype ?? '');
        if (!amqpish) continue;

        if (inv.method === 'BasicConsume' || inv.method === 'consume') {
          const q = str(ctx, unit, named(inv, 'queue', 0));
          if (!q) {
            ctx.issue('warn', 'unresolved-queue', `${unit.name}: ${inv.method} with non-literal queue`, ctx.loc(unit, inv.line));
            continue;
          }
          const fn = inv.args.find((x) => x.kind === 'function');
          const handler = fn ? fn.value : unit.id;
          const b = bindings.get(q);
          ctx.addConsumer({ broker: 'rabbitmq', topic: q, exchange: b?.exchange, routingKey: b?.routingKey, handler, location: ctx.loc(unit, inv.line) });
          continue;
        }
        if (inv.method === 'BasicPublish' || inv.method === 'publish') {
          const ex = str(ctx, unit, named(inv, 'exchange', 0)) ?? '';
          const key = str(ctx, unit, named(inv, 'routingKey', 1));
          const topic = ex || key;
          if (!topic) {
            ctx.issue('warn', 'unresolved-exchange', `${unit.name}: ${inv.method} with non-literal exchange`, ctx.loc(unit, inv.line));
            continue;
          }
          ctx.addPublish({ broker: 'rabbitmq', topic, routingKey: ex ? key : undefined, fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          continue;
        }
        if (inv.method === 'sendToQueue') {
          const q = str(ctx, unit, inv.args[0]);
          if (q) ctx.addPublish({ broker: 'rabbitmq', topic: q, fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          continue;
        }
        if (lang === 'java' && (inv.method === 'convertAndSend' || inv.method === 'send')) {
          const strings = inv.args.map((x) => (x.kind === 'string' || x.kind === 'template' || x.kind === 'ident' || x.kind === 'member' ? str(ctx, unit, x) : undefined));
          // (exchange, routingKey, message) or (routingKey, message)
          const payloadIdx = inv.args.findIndex((x) => x.kind === 'other' || x.kind === 'object');
          const n = payloadIdx === -1 ? inv.args.length : payloadIdx;
          if (n >= 2 && strings[0] !== undefined) {
            ctx.addPublish({ broker: 'rabbitmq', topic: strings[0], routingKey: strings[1], fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          } else if (n === 1 && strings[0] !== undefined) {
            ctx.addPublish({ broker: 'rabbitmq', topic: strings[0], fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          }
          continue;
        }
      }
    }
  },
};
