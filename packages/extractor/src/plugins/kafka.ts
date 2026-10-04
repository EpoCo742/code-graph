import type { Broker } from '@codegraph/schema';
import type { ArgValue, CodeUnit } from '../model.js';
import type { Plugin, PluginContext } from './types.js';
import { receiverType, splitList } from './util.js';

function topicsFromArg(ctx: PluginContext, unit: CodeUnit, arg: ArgValue | undefined): { topics: string[]; unresolved: string[] } {
  const topics: string[] = [];
  const unresolved: string[] = [];
  if (!arg) return { topics, unresolved };
  const items = arg.kind === 'array' ? (arg.items ?? []) : [arg.value];
  for (const item of items) {
    const a: ArgValue = arg.kind === 'array' ? { kind: /^["'`]/.test(item) || !/^[A-Za-z_$][\w$.]*$/.test(item) ? 'string' : 'member', value: item.replace(/^["'`]|["'`]$/g, ''), raw: item } : arg;
    const r = ctx.resolveString(a, unit);
    if (r?.resolved) topics.push(r.value);
    else if (r) {
      topics.push(r.value);
      unresolved.push(r.value);
    }
  }
  return { topics, unresolved };
}

export const kafka: Plugin = {
  name: 'kafka',
  detect(repo) {
    return (
      [...repo.dependencies].some((d) => /kafka|MassTransit/i.test(d)) ||
      repo.units.some(
        (u) =>
          u.attrs.some((a) => a.name === 'KafkaListener') ||
          u.invocations.some((i) => /^(Subscribe|subscribe|ProduceAsync|Produce|send)$/.test(i.method) && /kafka|producer|consumer/i.test(i.receiver ?? '')),
      )
    );
  },
  apply(ctx) {
    const { repo } = ctx;
    // MassTransit consumers: class implements IConsumer<T>
    for (const type of repo.types.values()) {
      for (const b of type.baseTypes) {
        const m = /^IConsumer<(.+)>$/.exec(b);
        if (!m) continue;
        const handler = type.methods.map((id) => repo.unitById.get(id)).find((u) => u && u.name.endsWith('.Consume'));
        if (handler) ctx.addConsumer({ broker: 'unknown', topic: m[1], handler: handler.id, location: ctx.loc(handler) });
      }
    }

    for (const unit of repo.units) {
      const lang = repo.files.find((f) => f.path === unit.file)?.language;
      // spring-kafka
      for (const a of unit.attrs.filter((x) => x.name === 'KafkaListener')) {
        const topics = splitList(a.named.topics ?? a.args[0]);
        const pattern = a.named.topicPattern;
        for (const t of topics.length ? topics : pattern ? [pattern] : []) {
          const resolved = resolveJavaTopic(ctx, unit, t);
          ctx.addConsumer({ broker: 'kafka', topic: resolved, group: a.named.groupId, handler: unit.id, location: ctx.loc(unit) });
        }
      }
      for (const inv of unit.invocations) {
        const receiver = inv.receiverChain[inv.receiverChain.length - 1];
        const rtype = receiver ? receiverType(repo, unit, receiver) : undefined;
        const kafkaish = /kafka|producer|consumer/i.test(receiver ?? '') || /Kafka|IProducer|IConsumer|Producer|Consumer/.test(rtype ?? '');

        /* Confluent.Kafka */
        if (lang === 'csharp' && inv.method === 'Subscribe' && kafkaish) {
          const { topics, unresolved } = topicsFromArg(ctx, unit, inv.args[0]);
          for (const t of topics) ctx.addConsumer({ broker: 'kafka', topic: t, handler: unit.id, location: ctx.loc(unit, inv.line) });
          for (const u of unresolved) ctx.issue('warn', 'unresolved-topic', `${unit.name}: topic reference ${u} could not be resolved`, ctx.loc(unit, inv.line));
          continue;
        }
        if (lang === 'csharp' && (inv.method === 'ProduceAsync' || inv.method === 'Produce') && kafkaish) {
          const { topics, unresolved } = topicsFromArg(ctx, unit, inv.args[0]);
          for (const t of topics) ctx.addPublish({ broker: 'kafka', topic: t, fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          for (const u of unresolved) ctx.issue('warn', 'unresolved-topic', `${unit.name}: topic reference ${u} could not be resolved`, ctx.loc(unit, inv.line));
          continue;
        }
        /* MassTransit publish */
        if (lang === 'csharp' && (inv.method === 'Publish' || inv.method === 'Send') && /publish|bus|endpoint/i.test(receiver ?? '')) {
          const t = inv.typeArgs?.[0] ?? /^new (\w+)/.exec(inv.args[0]?.value ?? '')?.[1];
          if (t) ctx.addPublish({ broker: 'unknown', topic: t, fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          continue;
        }
        /* spring-kafka template */
        if (lang === 'java' && inv.method === 'send' && (/kafka/i.test(receiver ?? '') || /KafkaTemplate/.test(rtype ?? ''))) {
          const r = ctx.resolveString(inv.args[0], unit);
          if (r) {
            ctx.addPublish({ broker: 'kafka', topic: r.value, fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
            if (!r.resolved) ctx.issue('warn', 'unresolved-topic', `${unit.name}: topic reference ${r.value} could not be resolved`, ctx.loc(unit, inv.line));
          }
          continue;
        }
        /* kafkajs */
        if ((lang === 'typescript' || lang === 'javascript') && inv.method === 'subscribe' && inv.args[0]?.kind === 'object') {
          const p = inv.args[0].props ?? {};
          const list = p.topics ? p.topics.split(',') : p.topic ? [p.topic] : [];
          const handler = findEachMessage(ctx, unit, receiver) ?? unit.id;
          // group id lives on kafka.consumer({ groupId }) where the consumer variable is created
          const creator = receiver ? (repo.variables.get(`${unit.file}:${receiver}`) ?? repo.variables.get(receiver)) : undefined;
          const groupFromCreator = creator?.args.find((a) => a.kind === 'object')?.props?.groupId;
          for (const t of list) {
            const r = ctx.resolveString({ kind: /^[A-Za-z_$][\w$.]*$/.test(t) && !/^[a-z0-9.-]+$/.test(t) ? 'ident' : 'string', value: t.trim(), raw: t }, unit);
            if (!r) continue;
            ctx.addConsumer({ broker: 'kafka', topic: r.value, group: p.groupId ?? groupFromCreator, handler, location: ctx.loc(unit, inv.line) });
          }
          continue;
        }
        if ((lang === 'typescript' || lang === 'javascript') && inv.method === 'send' && inv.args[0]?.kind === 'object' && inv.args[0].props?.topic && kafkaish) {
          const t = inv.args[0].props.topic;
          const r = ctx.resolveString({ kind: /^[A-Za-z_$][\w$.]*$/.test(t) && !/^[a-z0-9.-]+$/.test(t) ? 'ident' : 'string', value: t, raw: t }, unit);
          if (r) ctx.addPublish({ broker: 'kafka', topic: r.value, fromHandler: unit.id, location: ctx.loc(unit, inv.line) });
          continue;
        }
      }
    }
  },
};

function resolveJavaTopic(ctx: PluginContext, unit: CodeUnit, t: string): string {
  if (t.startsWith('${')) return t.replace(/^\$\{|\}$/g, '').split(':')[0];
  if (/^[A-Za-z_][\w.]*$/.test(t) && /[A-Z_]/.test(t.split('.').pop()!) && !/^[a-z]/.test(t)) {
    const r = ctx.resolveString({ kind: 'member', value: t, raw: t }, unit);
    if (r?.resolved) return r.value;
    ctx.issue('warn', 'unresolved-topic', `${unit.name}: topic constant ${t} could not be resolved`, ctx.loc(unit));
  }
  return t;
}

/** kafkajs: consumer.run({ eachMessage: async (...) => {...} }) in the same file -> handler unit id. */
function findEachMessage(ctx: PluginContext, unit: CodeUnit, receiver: string | undefined): string | undefined {
  const candidates = [unit, ...ctx.repo.units.filter((u) => u.file === unit.file && u !== unit)];
  for (const u of candidates) {
    for (const inv of u.invocations) {
      if (inv.method !== 'run' || inv.args[0]?.kind !== 'object') continue;
      if (receiver && inv.receiverChain[inv.receiverChain.length - 1] !== receiver) continue;
      const fn = inv.args[0].props?.eachMessage ?? inv.args[0].props?.eachBatch;
      if (fn && ctx.repo.unitById.has(fn)) return fn;
    }
  }
  return undefined;
}

export const BROKER_KAFKA: Broker = 'kafka';
