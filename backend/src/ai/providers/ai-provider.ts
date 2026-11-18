/** A language model behind one method. Chosen by AI_PROVIDER (anthropic | rules | none). */
export interface AiProvider {
  readonly name: 'anthropic' | 'rules' | 'none';
  readonly usesModel: boolean;
  complete(req: { system: string; user: string; maxTokens?: number }): Promise<string>;
}

/** No model: features fall back to the deterministic rules engine (the artifact's mock behaviour). */
export class RulesProvider implements AiProvider {
  readonly name = 'rules' as const;
  readonly usesModel = false;
  async complete(): Promise<string> {
    throw new Error('Rules provider has no model');
  }
}
