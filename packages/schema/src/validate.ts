import { LAYERS, MANIFEST_SCHEMA_VERSION, type ServiceManifest } from './manifest.js';

export interface ValidationError {
  path: string;
  message: string;
}

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY']);
const BROKERS = new Set(['kafka', 'rabbitmq', 'sqs', 'sns', 'servicebus', 'pubsub', 'unknown']);
const ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkLocation(v: unknown, path: string, errors: ValidationError[]) {
  if (!isObj(v)) return errors.push({ path, message: 'location must be an object' });
  if (typeof v.file !== 'string') errors.push({ path: `${path}.file`, message: 'must be a string' });
  if (typeof v.line !== 'number') errors.push({ path: `${path}.line`, message: 'must be a number' });
}

/** Structural validation of a manifest. Returns an empty array when valid. */
export function validateManifest(input: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isObj(input)) return [{ path: '', message: 'manifest must be an object' }];
  const m = input as Partial<ServiceManifest> & Record<string, unknown>;

  if (m.schemaVersion !== MANIFEST_SCHEMA_VERSION)
    errors.push({ path: 'schemaVersion', message: `expected "${MANIFEST_SCHEMA_VERSION}"` });

  if (!isObj(m.service)) errors.push({ path: 'service', message: 'required object' });
  else {
    if (typeof m.service.id !== 'string' || !ID_RE.test(m.service.id))
      errors.push({ path: 'service.id', message: 'must match ' + ID_RE.source });
    if (typeof m.service.name !== 'string') errors.push({ path: 'service.name', message: 'required string' });
    if (!LAYERS.includes(m.service.layer as never))
      errors.push({ path: 'service.layer', message: `must be one of ${LAYERS.join(', ')}` });
  }

  for (const key of ['endpoints', 'consumers', 'calls', 'publishes', 'handlers'] as const) {
    if (!Array.isArray(m[key])) errors.push({ path: key, message: 'required array' });
  }
  if (errors.length) return errors;

  const handlerIds = new Set<string>();
  m.handlers!.forEach((h, i) => {
    const p = `handlers[${i}]`;
    if (typeof h.id !== 'string') errors.push({ path: `${p}.id`, message: 'required string' });
    else if (handlerIds.has(h.id)) errors.push({ path: `${p}.id`, message: `duplicate handler id ${h.id}` });
    else handlerIds.add(h.id);
    checkLocation(h.location, `${p}.location`, errors);
    if (!Array.isArray(h.calls)) errors.push({ path: `${p}.calls`, message: 'required array' });
  });
  m.handlers!.forEach((h, i) => {
    (h.calls ?? []).forEach((c, j) => {
      if (!handlerIds.has(c)) errors.push({ path: `handlers[${i}].calls[${j}]`, message: `unknown handler ${c}` });
    });
  });

  const seen = new Set<string>();
  m.endpoints!.forEach((e, i) => {
    const p = `endpoints[${i}]`;
    if (!HTTP_METHODS.has(e.method)) errors.push({ path: `${p}.method`, message: 'invalid http method' });
    if (typeof e.path !== 'string' || !e.path.startsWith('/')) errors.push({ path: `${p}.path`, message: 'must start with /' });
    if (!handlerIds.has(e.handler)) errors.push({ path: `${p}.handler`, message: `unknown handler ${e.handler}` });
    if (seen.has(`e:${e.id}`)) errors.push({ path: `${p}.id`, message: 'duplicate endpoint id' });
    seen.add(`e:${e.id}`);
    checkLocation(e.location, `${p}.location`, errors);
  });
  m.consumers!.forEach((c, i) => {
    const p = `consumers[${i}]`;
    if (!BROKERS.has(c.broker)) errors.push({ path: `${p}.broker`, message: 'invalid broker' });
    if (typeof c.topic !== 'string' || !c.topic) errors.push({ path: `${p}.topic`, message: 'required string' });
    if (!handlerIds.has(c.handler)) errors.push({ path: `${p}.handler`, message: `unknown handler ${c.handler}` });
    checkLocation(c.location, `${p}.location`, errors);
  });
  m.calls!.forEach((c, i) => {
    const p = `calls[${i}]`;
    if (typeof c.url !== 'string') errors.push({ path: `${p}.url`, message: 'required string' });
    if (c.method !== undefined && !HTTP_METHODS.has(c.method)) errors.push({ path: `${p}.method`, message: 'invalid http method' });
    if (!handlerIds.has(c.fromHandler)) errors.push({ path: `${p}.fromHandler`, message: `unknown handler ${c.fromHandler}` });
    checkLocation(c.location, `${p}.location`, errors);
  });
  m.publishes!.forEach((c, i) => {
    const p = `publishes[${i}]`;
    if (!BROKERS.has(c.broker)) errors.push({ path: `${p}.broker`, message: 'invalid broker' });
    if (typeof c.topic !== 'string' || !c.topic) errors.push({ path: `${p}.topic`, message: 'required string' });
    if (!handlerIds.has(c.fromHandler)) errors.push({ path: `${p}.fromHandler`, message: `unknown handler ${c.fromHandler}` });
    checkLocation(c.location, `${p}.location`, errors);
  });
  return errors;
}

export function assertValidManifest(input: unknown): asserts input is ServiceManifest {
  const errors = validateManifest(input);
  if (errors.length) {
    throw new Error('Invalid manifest:\n' + errors.map((e) => `  ${e.path}: ${e.message}`).join('\n'));
  }
}
