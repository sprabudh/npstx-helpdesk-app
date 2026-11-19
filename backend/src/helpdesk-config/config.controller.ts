import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { env } from '../common/env';
import { CurrentUser } from '../common/decorators';
import { allowedHds, isHeadish, isWorker, PRIORITY_VISIBLE_TO_REQUESTER } from '../domain/policy';
import type { Principal } from '../domain/types';
import { FILE_RULES } from '../tickets/ticket-create.service';
import { HelpdeskConfigService } from './config.service';
import { AiService } from '../ai/ai.service';

/** Option lists and rules the UI renders, already filtered to the helpdesks this person may use. */
@ApiTags('config')
@ApiBearerAuth()
@Controller('config')
export class ConfigController {
  constructor(private readonly cfg: HelpdeskConfigService, private readonly ai: AiService) {}

  @Get() @ApiOperation({ summary: 'Helpdesk configuration for the signed-in person' })
  get(@CurrentUser() u: Principal) {
    const hds = allowedHds(u);
    const pick = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).filter(([k]) => hds.includes(k as never)));
    const s = <T = any>(k: string) => this.cfg.setting<T>(k);
    return {
      helpdesks: s<{ key: string; label: string }[]>('helpdesks').filter((h) => hds.includes(h.key as never)),
      categories: this.cfg.categories().filter((c) => hds.includes(c.helpdesk as never)).map((c) => ({
        helpdesk: c.helpdesk, key: c.key, name: c.name, subs: c.subs, defaultPriority: c.defaultPriority, leadId: c.leadId, leadName: this.cfg.name(c.leadId),
        ownerId: c.ownerId, ownerName: c.ownerId ? this.cfg.name(c.ownerId) : null, queueId: c.queueId, queueName: c.queueId ? this.cfg.name(c.queueId) : null,
        confidential: c.confidential, restricted: c.restricted, reopenAllowed: c.reopenAllowed, requestType: c.requestType, needsRecord: c.needsRecord,
        needsImpact: c.needsImpact, slaOverride: c.slaOverride, approvalRule: c.approvalRule, active: c.active,
        mgrApproval: c.mgrApproval, mgrApprovalSubs: c.mgrApprovalSubs, extraSteps: this.cfg.additionalSteps(c.helpdesk, c.key),
      })),
      formFields: this.cfg.allFields().filter((f) => f.active && hds.includes(f.helpdesk as never)),
      statuses: pick(s('statuses')), uiMap: pick(s('uiMap')), priorities: pick(s('priorities')),
      sla: s('sla'), escalation: s('escalation'), rules: s('rules'), ruleLabels: s('ruleLabels'), canned: s('canned'), closing: s('closing'),
      fieldLabels: s('fieldLabels'), locations: s('locations'), buildings: s('buildings'), learningSources: s('learningSources'),
      coreFields: pick(s('coreFields')), fieldTypes: s('fieldTypes'), approvalSteps: s('approvalSteps'), roleLabels: s('roleLabels'),
      leadHelpdesks: s('leadHelpdesks'), assignableRoles: s('assignableRoles'),
      aiSamples: s<{ hd: string }[]>('aiSamples').map((x, i) => ({ ...x, i })).filter((x) => hds.includes(x.hd as never)),
      redirect: pick(s('redirect')),
      fileRules: { maxFiles: FILE_RULES.maxFiles, maxBytes: FILE_RULES.maxBytes, pattern: FILE_RULES.allowed.source },
      managers: this.cfg.peopleList().filter((p) => !p.isQueue && p.roles.includes('MANAGER')).map((p) => ({ id: p.id, name: p.name })),
      displayTimeZone: env.displayTimeZone, demoMode: env.demoMode, ai: this.ai.status(),
      priorityVisible: PRIORITY_VISIBLE_TO_REQUESTER || isWorker(u) || isHeadish(u),
    };
  }
}
