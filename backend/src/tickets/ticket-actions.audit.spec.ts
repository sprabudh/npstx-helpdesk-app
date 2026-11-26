import { TicketEntity } from '../database/entities';
import { TicketActionsService } from './ticket-actions.service';

describe('TicketActionsService audit', () => {
  let service: TicketActionsService;
  let audit: { record: jest.Mock };
  let row: any;

  const principal: any = {
    id: 'u99',
    name: 'Desk Admin',
    dept: null,
    title: null,
    location: null,
    managerId: null,
    roles: new Set(['HD_ADMIN'] as any),
    hrCats: new Set<string>(),
  };

  beforeEach(() => {
    row = {
      t: {
        key: 'IT-000123',
        helpdesk: 'IT',
        categoryKey: 'LAPTOP',
        status: 'New',
        priority: 'Medium',
        requesterId: 'u1',
        assigneeId: 'u2',
        confidential: false,
        asgHist: [],
        escLog: [],
        updatedAt: new Date('2026-11-26T05:17:59.000Z'),
      },
      ctx: {
        helpdesk: 'IT',
        categoryKey: 'LAPTOP',
        requesterId: 'u1',
        assigneeId: 'u2',
        confidential: false,
        followers: [],
        approvals: [],
        category: { leadId: 'u2', restricted: false },
        requesterManagerId: null,
      },
      closed: false,
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    const repo = { update: jest.fn().mockResolvedValue(undefined) };
    const loader = {
      one: jest.fn().mockResolvedValue(row),
      event: jest.fn().mockResolvedValue(undefined),
      ds: { getRepository: jest.fn((entity) => (entity === TicketEntity ? repo : {})) },
    };
    const cfg = {
      statusModel: jest.fn().mockReturnValue({ tr: { New: ['In progress'] }, closed: [], closing: [], wait: 'Waiting' }),
      setting: jest.fn().mockReturnValue({}),
      person: jest.fn().mockReturnValue(null),
      name: jest.fn((id: string) => id),
    };
    const events = { emitTicketEvent: jest.fn().mockResolvedValue(undefined) };
    const providers = { for: jest.fn().mockReturnValue({ onStatusChanged: jest.fn().mockResolvedValue(undefined) }) };
    service = new TicketActionsService(loader as any, {} as any, cfg as any, events as any, providers as any, audit as any, {} as any);
  });

  it('records status changes to the audit service without note bodies', async () => {
    await service.setStatus(principal, 'IT-000123', 'In progress');

    expect(audit.record).toHaveBeenCalledWith(
      'u99',
      'ticket.status',
      expect.stringContaining('New → In progress'),
      expect.objectContaining({
        target: 'IT-000123',
        detail: expect.objectContaining({
          ticket: 'IT-000123',
          helpdesk: 'IT',
          category: 'LAPTOP',
          from: 'New',
          to: 'In progress',
        }),
      }),
    );
  });
});
