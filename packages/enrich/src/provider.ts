import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';

export interface CompletionRequest<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  model: string;
}

export interface CompletionResult<T> {
  data?: T;
  usage?: { input: number; cached: number; output: number };
  note?: string;
}

/** A model backend that returns schema-validated JSON for a prompt. */
export interface Provider {
  readonly name: 'anthropic' | 'copilot';
  complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>>;
  close(): Promise<void>;
}

/** Claude via the Anthropic SDK. Structured output + prompt caching on the system prompt. */
export class AnthropicProvider implements Provider {
  readonly name = 'anthropic' as const;
  constructor(readonly client: Anthropic = new Anthropic()) {}

  async complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>> {
    const res = await this.client.messages.parse({
      model: req.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.prompt }],
      output_config: { format: zodOutputFormat(req.schema as never) },
    });
    if (res.stop_reason === 'refusal') return { note: `refused: ${res.stop_details?.explanation ?? ''}` };
    if (!res.parsed_output) return { note: 'output did not match schema' };
    return {
      data: res.parsed_output as T,
      usage: { input: res.usage.input_tokens, cached: res.usage.cache_read_input_tokens ?? 0, output: res.usage.output_tokens },
    };
  }

  async close() {}
}

/**
 * GitHub Copilot via @github/copilot-sdk. Uses the developer's Copilot seat
 * (COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN, or the `copilot` CLI login),
 * so no separate model API key is needed. One short-lived session per request,
 * with every built-in tool disabled: the model only sees the prompt text.
 */
export class CopilotProvider implements Provider {
  readonly name = 'copilot' as const;
  private client?: { createSession: (cfg: Record<string, unknown>) => Promise<CopilotSession>; stop: () => Promise<void>; start: () => Promise<void> };

  constructor(private readonly options: { gitHubToken?: string } = {}) {}

  private async ensure() {
    if (this.client) return this.client;
    const sdk = await import('@github/copilot-sdk');
    const client = new sdk.CopilotClient(this.options.gitHubToken ? { gitHubToken: this.options.gitHubToken } : {});
    await client.start();
    this.client = client as unknown as typeof this.client;
    return this.client!;
  }

  async complete<T>(req: CompletionRequest<T>): Promise<CompletionResult<T>> {
    const client = await this.ensure();
    const sdk = await import('@github/copilot-sdk');
    const session = await client.createSession({
      model: req.model,
      systemMessage: { mode: 'replace', content: req.system },
      availableTools: [],
      onPermissionRequest: sdk.approveAll,
    });
    try {
      const data = (await session.sendAndWait({ prompt: req.prompt }, req.schema as never)) as T;
      const parsed = req.schema.safeParse(data);
      if (!parsed.success) return { note: 'output did not match schema' };
      return { data: parsed.data };
    } finally {
      await session.disconnect();
    }
  }

  async close() {
    await this.client?.stop();
    this.client = undefined;
  }
}

interface CopilotSession {
  sendAndWait(options: { prompt: string }, schema: unknown, timeout?: number): Promise<unknown>;
  disconnect(): Promise<void>;
}

export type ProviderName = Provider['name'];

/** Pick a provider: explicit flag, else Anthropic when ANTHROPIC_API_KEY is set, else Copilot. */
export function createProvider(name?: ProviderName): Provider {
  const chosen = name ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'copilot');
  if (chosen === 'anthropic') return new AnthropicProvider();
  return new CopilotProvider({ gitHubToken: process.env.COPILOT_GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN });
}

export const DEFAULT_MODELS: Record<ProviderName, { summaries: string; flows: string }> = {
  anthropic: { summaries: 'claude-sonnet-5-5', flows: 'claude-opus-5-5' },
  // Copilot model ids follow the Copilot catalogue (see `copilot --help` or client.listModels()).
  copilot: { summaries: 'auto', flows: 'auto' },
};
