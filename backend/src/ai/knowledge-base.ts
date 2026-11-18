import type { FaqEntity } from '../database/entities';

export interface KbDoc {
  id: string;
  helpdesk: string;
  kind: 'faq' | 'policy';
  title: string;
  text: string;
  faqId?: number;
  categoryKey?: string | null;
}

const STOP = new Set(['the', 'and', 'for', 'what', 'is', 'my', 'of', 'to', 'an', 'in', 'on', 'how', 'why', 'can', 'me', 'do', 'does', 'it', 'are', 'with', 'status', 'ticket', 'tickets', 'please', 'show', 'which', 'about', 'from', 'have', 'has', 'not', 'when', 'will', 'there', 'this', 'that', 'your', 'you', 'get', 'any', 'was', 'did', 'see', 'where', 'who', 'its', 'into']);
export const tokens = (q: string) => q.toLowerCase().split(/[^a-z0-9&-]+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * One knowledge base per helpdesk, built from that helpdesk's FAQs plus generated policy notes
 * (categories, SLA). Retrieval is BM25 over word tokens: no embeddings service needed. A person only
 * ever queries the knowledge bases of helpdesks they may use (guardrail).
 */
export class KnowledgeBase {
  private docs: KbDoc[] = [];
  private df = new Map<string, number>();
  private avgLen = 1;

  constructor(readonly helpdesk: string) {}

  build(faqs: FaqEntity[], policies: { title: string; text: string }[]) {
    this.docs = [
      ...faqs.map((f) => ({ id: `faq:${f.id}`, helpdesk: this.helpdesk, kind: 'faq' as const, title: f.question, text: `${f.question} ${f.answer}`, faqId: f.id, categoryKey: f.categoryKey })),
      ...policies.map((p, i) => ({ id: `policy:${this.helpdesk}:${i}`, helpdesk: this.helpdesk, kind: 'policy' as const, title: p.title, text: p.text })),
    ];
    this.df.clear();
    let total = 0;
    for (const d of this.docs) {
      const ws = new Set(tokens(d.text));
      total += tokens(d.text).length;
      ws.forEach((w) => this.df.set(w, (this.df.get(w) || 0) + 1));
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 1;
  }

  search(q: string, k = 4): (KbDoc & { score: number })[] {
    const qs = tokens(q);
    if (!qs.length) return [];
    const N = this.docs.length;
    return this.docs
      .map((d) => {
        const ws = tokens(d.text);
        const title = tokens(d.title);
        let score = 0;
        for (const w of qs) {
          const tf = ws.filter((x) => x === w).length;
          if (!tf) continue;
          const idf = Math.log(1 + (N - (this.df.get(w) || 0) + 0.5) / ((this.df.get(w) || 0) + 0.5));
          score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (ws.length / this.avgLen))));
          if (title.includes(w)) score += idf * 0.6;
        }
        return { ...d, score };
      })
      .filter((d) => d.score > 0.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}
