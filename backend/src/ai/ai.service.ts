import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { clock, fdt, fmtH } from '../common/clock';
import { env } from '../common/env';
import { AppError } from '../common/errors';
import { CommentEntity, FaqEntity } from '../database/entities';
import { allowedHds, approvalStage, canWork, HEAD_ROLES, isWorker } from '../domain/policy';
import { HD_ORDER, Principal } from '../domain/types';
import { HelpdeskConfigService } from '../helpdesk-config/config.service';
import { Row, TicketLoader } from '../tickets/ticket-loader.service';
import { TicketQueryService } from '../tickets/ticket-query.service';
import { DATA_FENCE, parseJsonObject, redact, SYSTEM_BASE } from './guardrails';
import { KnowledgeBase, tokens } from './knowledge-base';
import { AnthropicProvider } from './providers/anthropic.provider';
import { AiProvider, RulesProvider } from './providers/ai-provider';
import { aiParse, DraftResult, ParseContext } from './rules-engine';

export type Part = { t: 'text' | 'b' | 'ticket' | 'br' | 'tc'; v?: string };
const HDL: Record<string, string> = { HR: 'HR', LND: 'L&D', IT: 'IT and Support', ADM: 'Admin Desk', SF: 'Salesforce' };

/** "**bold**" and "[to confirm]" markers in FAQ answers become parts the UI renders safely. */
export function mdParts(s: string): Part[] {
  const out: Part[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > i) out.push({ t: 'text', v: s.slice(i, m.index) });
    out.push(m[1] ? { t: 'b', v: m[1] } : { t: 'tc', v: `TC: ${m[2]}` });
    i = m.index + m[0].length;
  }
  if (i < s.length) out.push({ t: 'text', v: s.slice(i) });
  return out;
}

@Injectable()
export class AiService {
  private readonly log = new Logger('AiService');
  private readonly provider: AiProvider | null;
  private kbs = new Map<string, KnowledgeBase>();
  private kbBuiltAt = 0;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly cfg: HelpdeskConfigService,
    private readonly loader: TicketLoader,
    private readonly q: TicketQueryService,
  ) {
    if (env.ai.provider === 'anthropic') this.provider = env.ai.apiKey ? new AnthropicProvider() : null;
    else if (env.ai.provider === 'rules') this.provider = new RulesProvider();
    else this.provider = null;
  }

  status() {
    const enabled = !!this.provider;
    return {
      enabled,
      provider: this.provider?.name ?? 'none',
      mode: !enabled ? 'off' : this.provider!.usesModel ? 'model' : 'rules',
      model: this.provider?.usesModel ? env.ai.model : null,
      reason: enabled ? null : env.ai.provider === 'anthropic' ? 'ANTHROPIC_API_KEY is not set' : 'AI_PROVIDER is none',
    };
  }
  private requireEnabled() {
    if (!this.provider) throw new AppError(503, 'AI_DISABLED', 'AI features are turned off on this server. Fill the form yourself or search the FAQs.');
    return this.provider;
  }

  /** One knowledge base per helpdesk from its FAQs and generated policy notes; rebuilt every 5 minutes. */
  private async kb(hd: string): Promise<KnowledgeBase> {
    if (Date.now() - this.kbBuiltAt > 300000 || !this.kbs.size) {
      const faqs = await this.ds.getRepository(FaqEntity).find();
      for (const h of HD_ORDER) {
        const kb = new KnowledgeBase(h);
        const pol = this.cfg.categories(h).filter((c) => c.active).map((c) => ({
          title: `${HDL[h]} · ${c.name}`,
          text: `${c.name}: ${c.subs.join(', ')}. Default priority ${c.defaultPriority ?? 'Medium'}; ${this.cfg.slaText(h, c.key, c.defaultPriority ?? 'Medium')}.${c.confidential ? ' Confidential category.' : ''}`,
        }));
        kb.build(faqs.filter((f) => f.helpdesk === h), pol);
        this.kbs.set(h, kb);
      }
      this.kbBuiltAt = Date.now();
    }
    return this.kbs.get(hd)!;
  }
  /** Retrieval across the helpdesks this person may use only (guardrail 1). */
  private async retrieve(u: Principal, text: string, k = 4, only?: string) {
    const hds = allowedHds(u).filter((h) => !only || h === only);
    const hits = (await Promise.all(hds.map(async (h) => (await this.kb(h)).search(text, k)))).flat();
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }

  private parseCtx(u: Principal): ParseContext {
    return {
      me: { id: u.id, managerId: u.managerId },
      allowedHds: allowedHds(u),
      priorities: this.cfg.setting('priorities'),
      keywords: this.cfg.setting('aiKeywords'),
      people: this.cfg.peopleList().map((p) => ({ id: p.id, name: p.name, dept: p.dept, isQueue: p.isQueue, roles: p.roles })),
      sfDepartments: this.cfg.setting('sfDepartments'),
      today: clock.now(),
    };
  }

  // ---------- Dashboard: search + ask ----------
  async ask(u: Principal, text: string, full: boolean) {
    this.requireEnabled();
    const qtext = text.trim().slice(0, 500);
    const ql = qtext.toLowerCase();
    const ws = tokens(qtext);
    const vis = await this.loader.visible(u);
    const score = (r: Row) => {
      const hay = [r.t.key, r.t.title, r.ctx.category?.name, r.t.subCategory, HDL[r.t.helpdesk], this.cfg.name(r.t.requesterId), this.cfg.name(r.t.assigneeId), r.t.status].join(' ').toLowerCase();
      return ws.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    };
    const idm = qtext.match(/\b(HR|LND|IT|ADM|SF)-\d{3,6}\b/i);
    const tickets = idm
      ? vis.filter((r) => r.t.key.toLowerCase() === idm[0].toLowerCase())
      : vis.map((r) => [r, score(r)] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1] || b[0].t.updatedAt.getTime() - a[0].t.updatedAt.getTime()).map((x) => x[0]);
    const faqs = (await this.retrieve(u, qtext, 4)).filter((d) => d.kind === 'faq');
    const faqDtos = faqs.map((d) => ({ id: d.faqId!, helpdesk: d.helpdesk, question: d.title, categoryKey: d.categoryKey ?? null }));
    const res: Record<string, any> = { q: qtext, tickets: tickets.slice(0, 6).map((r) => this.q.listItem(u, r)), total: tickets.length, faqs: faqDtos, answer: null };
    if (!full) return res;

    const own = vis.filter((r) => r.t.requesterId === u.id);
    const ownOpen = own.filter((r) => !r.closed);
    const parts: Part[] = [];
    const src: any[] = [];
    const push = (...p: Part[]) => parts.push(...p);
    const line = (r: Row) => {
      push({ t: 'ticket', v: r.t.key }, { t: 'text', v: ` ${r.t.title}: ` }, { t: 'b', v: r.t.status }, { t: 'text', v: ` (${this.q.uiStatus(r)})` });
      const waiting = this.q.isWaiting(r);
      push({ t: 'text', v: waiting ? ` · ${this.cfg.name(r.t.assigneeId)} needs a reply from you` : r.t.status === 'Pending approval' ? ' · waiting for approval' : r.closed ? '' : ` · with ${this.cfg.name(r.t.assigneeId)}` });
      if (!r.closed) push({ t: 'text', v: ` · resolution due ${fdt(r.t.resolutionDue)}` });
      push({ t: 'text', v: '.' });
    };
    const lines = (rs: Row[], f: (r: Row) => void) => rs.forEach((r, i) => { if (i) push({ t: 'br' }); f(r); });
    const setT = (a: Row[]) => { res.tickets = a.slice(0, 6).map((r) => this.q.listItem(u, r)); res.total = a.length; };
    const sfAllowed = allowedHds(u).includes('SF');
    if (/sales ?force/.test(ql) && !sfAllowed) {
      push({ t: 'text', v: 'The Salesforce helpdesk is available only to employees in Sales, Presales and Solutions. Your department is ' }, { t: 'b', v: u.dept ?? 'not set' },
        { t: 'text', v: ', so it is hidden for you. If your department record is wrong, raise an HR ticket under Employee records and letters.' });
      src.push({ type: 'policy', label: 'Helpdesk access rules' });
      setT([]);
    } else if (idm) {
      if (tickets.length) { line(tickets[0]); src.push({ type: 'ticket', key: tickets[0].t.key }); }
      else push({ t: 'text', v: `I could not find ${idm[0].toUpperCase()} among the tickets you can see.` });
    } else if (/escalat/.test(ql)) {
      const pool = isWorker(u) || HEAD_ROLES.some((r) => u.roles.has(r)) ? vis : own;
      const e = pool.filter((r) => !r.closed && (r.t.escalationLevel > 0 || r.t.status === 'Escalated'));
      if (e.length) {
        push({ t: 'text', v: `${e.length} open ticket${e.length > 1 ? 's are' : ' is'} escalated:` }, { t: 'br' });
        lines(e.slice(0, 4), (r) => push({ t: 'ticket', v: r.t.key }, { t: 'text', v: ` ${r.t.title} · Level ${r.t.escalationLevel || 1}` }));
      } else push({ t: 'text', v: 'None of the open tickets you can see is escalated.' });
      setT(e);
      e.slice(0, 3).forEach((r) => src.push({ type: 'ticket', key: r.t.key }));
    } else if (/pending|waiting|need.{0,12}(reply|input)|approv/.test(ql)) {
      const p = ownOpen.filter((r) => this.q.uiStatus(r) === 'Pending Input');
      const ap = vis.filter((r) => approvalStage(u, r.ctx));
      if (p.length) { push({ t: 'text', v: `${p.length} of your tickets ${p.length > 1 ? 'are' : 'is'} pending input:` }, { t: 'br' }); lines(p, line); }
      else push({ t: 'text', v: 'None of your tickets is waiting for your input.' });
      if (ap.length) push({ t: 'br' }, { t: 'text', v: `${ap.length} request${ap.length > 1 ? 's are' : ' is'} waiting for your approval.` });
      setT([...p, ...ap]);
      p.forEach((r) => src.push({ type: 'ticket', key: r.t.key }));
    } else if (/status|update|progress|where is|what happened|any news/.test(ql)) {
      let m = ownOpen.map((r) => [r, score(r)] as const).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      if (!m.length) m = ownOpen;
      if (m.length) lines(m.slice(0, 3), line);
      else push({ t: 'text', v: 'You have no open tickets. Closed ones are on the Closed tickets page and in History.' });
      setT(m);
      m.slice(0, 3).forEach((r) => src.push({ type: 'ticket', key: r.t.key }));
    } else if (/how (long|many days)|\bsla\b|when will|days for|time for/.test(ql)) {
      const g = aiParse(qtext, this.parseCtx(u));
      const hd = g && !('blocked' in g) ? g.hd : 'HR';
      const cat = g && !('blocked' in g) ? g.cat : null;
      const c = cat ? this.cfg.category(hd, cat) : null;
      const pri = c?.defaultPriority || 'Medium';
      const [r, x] = this.cfg.slaFor(hd, cat, pri);
      push({ t: c ? 'b' : 'text', v: c ? `${HDL[hd]} · ${c.name}` : HDL[hd] }, { t: 'text', v: ` tickets at ${pri} priority get a first response within ` }, { t: 'b', v: fmtH(r) },
        { t: 'text', v: ' and are resolved within ' }, { t: 'b', v: fmtH(x) }, { t: 'text', v: '. Time waiting for you or for an approval does not count. ' }, { t: 'tc', v: 'TC: targets awaiting sign-off' });
      if (faqs[0]) src.push({ type: 'faq', id: faqs[0].faqId, helpdesk: faqs[0].helpdesk, label: faqs[0].title });
      src.push({ type: 'policy', label: 'SLA targets' });
    } else if (/raise|create|log a|open a ticket|new ticket/.test(ql)) {
      push({ t: 'text', v: 'You can raise a ticket straight from here. Use the button below; the form opens with your text filled in and the helpdesk and category guessed for you.' });
    } else {
      const model = this.provider?.usesModel ? await this.modelAnswer(u, qtext, ownOpen) : null;
      if (model) {
        push(...mdParts(model.text));
        model.sources.forEach((s) => src.push(s));
      } else if (faqs.length) {
        const f = await this.ds.getRepository(FaqEntity).findOne({ where: { id: faqs[0].faqId } });
        push(...mdParts(f?.answer ?? ''));
        src.push({ type: 'faq', id: faqs[0].faqId, helpdesk: faqs[0].helpdesk, label: faqs[0].title });
      } else if (tickets.length) push({ t: 'text', v: `I found ${tickets.length} ticket${tickets.length > 1 ? 's' : ''} that match.` });
      else push({ t: 'text', v: 'I could not find an answer in the FAQs or your tickets. Raise a ticket and the right team will pick it up.' });
    }
    res.answer = { parts, sources: src, mode: this.provider?.usesModel ? 'model' : 'rules' };
    return res;
  }

  /** Model answer grounded in this person's knowledge bases and own non-confidential open tickets (guardrails 1-3). */
  private async modelAnswer(u: Principal, question: string, ownOpen: Row[]) {
    const docs = await this.retrieve(u, question, 5);
    if (!docs.length) return null;
    const kb = docs.map((d, i) => `[${i + 1}] (${HDL[d.helpdesk]} ${d.kind}) ${d.title}\n${d.text}`).join('\n\n');
    const mine = ownOpen.filter((r) => !r.t.confidential).slice(0, 8).map((r) => `${r.t.key} | ${r.t.title} | ${r.t.status}`).join('\n');
    try {
      const out = await this.provider!.complete({
        system: `${SYSTEM_BASE} Answer in at most 4 sentences. Use **bold** for key numbers. End with the source numbers you used, like "Sources: 1, 3".`,
        user: `${DATA_FENCE('knowledge', kb)}\n${DATA_FENCE('my_open_tickets', mine || 'none')}\n${DATA_FENCE('user_text', redact(question))}`,
        maxTokens: 400,
      });
      const used = [...(out.match(/Sources?:\s*([\d,\s]+)/i)?.[1] ?? '').matchAll(/\d+/g)].map((m) => docs[Number(m[0]) - 1]).filter(Boolean);
      const text = out.replace(/Sources?:\s*[\d,\s]+\.?\s*$/i, '').trim();
      return { text, sources: (used.length ? used : docs.slice(0, 1)).map((d) => (d.kind === 'faq' ? { type: 'faq', id: d.faqId, helpdesk: d.helpdesk, label: d.title } : { type: 'policy', label: d.title })) };
    } catch {
      return null;
    }
  }

  // ---------- Raise drawer: FAQ deflection ----------
  async faqSuggest(u: Principal, text: string, hd?: string) {
    this.requireEnabled();
    const docs = (await this.retrieve(u, text, 6, hd)).filter((d) => d.kind === 'faq').slice(0, 3);
    return { suggestions: docs.map((d) => ({ id: d.faqId!, helpdesk: d.helpdesk, question: d.title, answer: d.text.slice(d.title.length).trim(), categoryKey: d.categoryKey ?? null, score: Math.round(d.score * 100) / 100 })) };
  }

  // ---------- Raise drawer: draft from speech or typed text ----------
  async draft(u: Principal, transcript: string, hd?: string) {
    const p = this.requireEnabled();
    const ctx = this.parseCtx(u);
    let result: DraftResult | { blocked: string } | null = null;
    let source: 'model' | 'rules' = 'rules';
    if (p.usesModel) {
      result = await this.modelDraft(u, transcript, hd);
      if (result) source = 'model';
    }
    if (!result) result = aiParse(transcript, ctx);
    if (result && !('blocked' in result) && hd && result.hd !== hd && !allowedHds(u).includes(result.hd as never)) result = null;
    if (!result) return { ok: false, reason: 'unclear' as const, source };
    if ('blocked' in result) return { ok: false, reason: 'blocked' as const, source };
    return { ok: true, source, draft: result };
  }

  private async modelDraft(u: Principal, transcript: string, _hd?: string): Promise<DraftResult | { blocked: string } | null> {
    const hds = allowedHds(u);
    const catalog = hds.map((h) => ({
      helpdesk: h,
      priorities: this.cfg.priorities(h),
      categories: this.cfg.categories(h).filter((c) => c.active).map((c) => ({
        key: c.key, name: c.name, subs: c.subs,
        fields: this.cfg.formFields(h, c.key).map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options ?? undefined })),
      })),
    }));
    const hdFields: Record<string, string[]> = { HR: ['location', 'payMonth', 'datesAffected', 'claimId'], LND: ['reqType', 'learningSource', 'learningItem', 'sessionAt', 'justification', 'problem', 'device'], SF: ['account', 'oppId', 'record', 'impact'] };
    try {
      const out = await this.provider!.complete({
        system: `${SYSTEM_BASE} Fill an NPSTX helpdesk ticket from what the employee said. Pick exactly one helpdesk, category and sub-category from the catalog. ` +
          'Return only JSON: {"helpdesk":"","category":"","subCategory":"","title":"","description":"","priority":"","fields":{},"ccFirstNames":[],"copyManager":false,"unsure":[]}. ' +
          `Extra field keys for HR: ${hdFields.HR.join(', ')}; L&D: ${hdFields.LND.join(', ')} (reqType is "course" or "portal"); Salesforce: ${hdFields.SF.join(', ')}. ` +
          'Dates are YYYY-MM-DD. List in "unsure" any field you guessed. If the request needs a helpdesk not in the catalog, return {"blocked":true}.',
        user: `${DATA_FENCE('catalog', JSON.stringify(catalog))}\n${DATA_FENCE('today', clock.now().toISOString().slice(0, 10))}\n${DATA_FENCE('user_text', redact(transcript))}`,
        maxTokens: 900,
      });
      const o = parseJsonObject(out);
      if (!o) return null;
      if (o.blocked) return { blocked: 'SF' };
      const hd = String(o.helpdesk ?? '');
      const c = this.cfg.category(hd, String(o.category ?? ''));
      if (!hds.includes(hd as never) || !c || !c.active || !c.subs.includes(String(o.subCategory ?? ''))) return null; // guardrail 4
      const allowedKeys = new Set([...this.cfg.formFields(hd, c.key).map((f) => f.key), ...(hdFields[hd] ?? [])]);
      const f: Record<string, string> = { sub: String(o.subCategory), title: String(o.title ?? '').slice(0, 150), desc: String(o.description ?? transcript).slice(0, 4000) };
      if (this.cfg.priorities(hd).includes(String(o.priority)) && hd !== 'HR') f.pri = String(o.priority);
      for (const [k, v] of Object.entries((o.fields as Record<string, unknown>) ?? {})) {
        if (!allowedKeys.has(k) || v === null || v === undefined || v === '') continue;
        const def = this.cfg.formFields(hd, c.key).find((x) => x.key === k);
        if (def?.options && !def.options.includes(String(v))) continue;
        f[k] = String(v);
      }
      if (hd === 'LND' && !f.reqType) f.reqType = c.requestType === 'course' ? 'course' : 'portal';
      const people = this.cfg.peopleList();
      const cc = ((o.ccFirstNames as string[]) ?? []).map((n) => people.find((p) => !p.isQueue && p.name.split(' ')[0] === n && p.id !== u.id)?.id).filter((x): x is string => !!x);
      const unsure = ((o.unsure as string[]) ?? []).filter((k) => allowedKeys.has(k));
      return { hd, cat: c.key, f, cc, mgr: !!o.copyManager, unsure };
    } catch {
      return null;
    }
  }

  // ---------- Ticket detail: summarise the activity feed ----------
  async summarise(u: Principal, key: string) {
    this.requireEnabled();
    const r = await this.loader.one(u, key);
    const work = canWork(u, r.ctx);
    const comments = (await this.ds.getRepository(CommentEntity).find({ where: { ticketKey: key }, order: { createdAt: 'ASC', id: 'ASC' } })).filter((c) => work || !c.internal);
    const pub = comments.filter((c) => !c.internal), int = comments.filter((c) => c.internal);
    const last = comments[comments.length - 1];
    const waiting = this.q.isWaiting(r) ? `${this.cfg.name(r.t.requesterId)} (requester)` : r.t.status === 'Pending approval' ? 'an approver' : r.closed ? null : this.cfg.name(r.t.assigneeId);
    const rules = [
      `${r.t.key} is ${r.t.status} (${this.q.uiStatus(r)}), raised by ${this.cfg.name(r.t.requesterId)} on ${fdt(r.t.createdAt)} and assigned to ${this.cfg.name(r.t.assigneeId)}.`,
      `${pub.length} public repl${pub.length === 1 ? 'y' : 'ies'}${work ? ` and ${int.length} internal note${int.length === 1 ? '' : 's'}` : ''}.`,
      last ? `Latest: ${this.cfg.name(last.authorId)} on ${fdt(last.createdAt)}: "${last.body.slice(0, 160)}${last.body.length > 160 ? '…' : ''}"` : 'No replies yet.',
      waiting ? `Waiting on: ${waiting}.` : 'Closed.',
    ];
    // Confidential tickets never leave the server (guardrail 2).
    if (!this.provider!.usesModel || r.t.confidential) return { mode: 'rules', summary: rules, note: r.t.confidential ? 'Confidential ticket: summarised on the server without the AI model.' : null };
    try {
      const feed = comments.map((c) => `${fdt(c.createdAt)} ${this.cfg.name(c.authorId)}${c.internal ? ' (internal)' : ''}: ${redact(c.body)}`).join('\n');
      const out = await this.provider!.complete({
        system: `${SYSTEM_BASE} Summarise a helpdesk ticket for the person reading it in at most 4 short bullet lines: what the problem is, what has been done, what happens next and who it is waiting on.${work ? '' : ' Do not mention internal notes.'}`,
        user: `${DATA_FENCE('ticket', `${r.t.key} | ${r.t.title} | status ${r.t.status} | assigned to ${this.cfg.name(r.t.assigneeId)}\n${redact(r.t.description)}`)}\n${DATA_FENCE('activity', feed || 'no replies')}`,
        maxTokens: 300,
      });
      const lines = out.split('\n').map((x) => x.replace(/^[-*•\s]+/, '').trim()).filter(Boolean).slice(0, 4);
      return { mode: 'model', summary: lines.length ? lines : rules, note: null };
    } catch {
      return { mode: 'rules', summary: rules, note: 'The AI model did not respond, so this is a basic summary.' };
    }
  }
}
