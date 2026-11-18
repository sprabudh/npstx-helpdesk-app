import { Logger } from '@nestjs/common';
import { env } from '../../common/env';
import { AiProvider } from './ai-provider';

/** Anthropic Messages API over HTTPS. The key comes only from ANTHROPIC_API_KEY. Prompts and answers are never logged. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  readonly usesModel = true;
  private readonly log = new Logger('AnthropicProvider');

  async complete(req: { system: string; user: string; maxTokens?: number }): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), env.ai.timeoutMs);
    try {
      const res = await fetch(`${env.ai.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': env.ai.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: env.ai.model, max_tokens: req.maxTokens ?? 800, system: req.system, messages: [{ role: 'user', content: req.user }] }),
      });
      if (!res.ok) {
        this.log.warn(`model call failed: HTTP ${res.status}`);
        throw new Error(`AI provider returned HTTP ${res.status}`);
      }
      const j = (await res.json()) as { content: { type: string; text?: string }[] };
      return j.content.filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
    } finally {
      clearTimeout(timer);
    }
  }
}
