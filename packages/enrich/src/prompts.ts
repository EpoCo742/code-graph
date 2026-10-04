import { z } from 'zod';

/** Bump when prompt wording changes so cached results are recomputed. */
export const PROMPT_VERSION = 'v1';

export const ServiceSummarySchema = z.object({
  description: z.string().describe('One or two sentences on what this service is responsible for.'),
  handlers: z.array(
    z.object({
      id: z.string(),
      summary: z.string().describe('One sentence: what this handler does and what it triggers downstream.'),
    }),
  ),
  endpoints: z.array(
    z.object({
      id: z.string(),
      summary: z.string().describe('One sentence for API docs.'),
      useCase: z.string().describe('Short business-facing label, e.g. "Place order".'),
    }),
  ),
});
export type ServiceSummary = z.infer<typeof ServiceSummarySchema>;

export const FlowNamesSchema = z.object({
  flows: z.array(
    z.object({
      id: z.string(),
      name: z.string().describe('Short imperative name, e.g. "Place order".'),
      useCase: z.string().describe('Business scenario this flow implements.'),
      description: z.string().describe('Two to four sentences describing the end-to-end behaviour across services.'),
    }),
  ),
});
export type FlowNames = z.infer<typeof FlowNamesSchema>;

/** Stable system prompt: identical bytes every request so it is served from the prompt cache. */
export const SERVICE_SYSTEM_PROMPT = `You document service architecture for an engineering team.
You receive a service manifest (endpoints, message consumers, outbound HTTP calls, message publishes, and the handler call graph) plus source slices for selected handlers.
Write precise, factual summaries grounded only in the given code. Do not invent behaviour. Prefer domain vocabulary found in the code (entity names, topic names, route names).
Return every handler id and every endpoint id you were given, exactly as given.`;

export const FLOW_SYSTEM_PROMPT = `You name and describe end-to-end application flows for an engineering team.
Each flow is an ordered list of steps across services: HTTP endpoints called, messages published, and consumers triggered, with handler summaries where available.
Produce a short imperative name, a business use-case label, and a factual description for every flow id you are given. Ground everything in the steps; do not invent behaviour.`;
