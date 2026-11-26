import { AttachmentEntity, EventEntity, FollowerEntity, SequenceEntity, TicketEntity } from '../database/entities';
import { TicketCreateService } from './ticket-create.service';

describe('TicketCreateService audit', () => {
  it('records successful ticket creation with safe metadata', async () => {
    const principal: any = {
      id: 'u1',
      name: 'Arjun Kumar',
      dept: null,
      title: null,
      location: null,
      managerId: null,
      roles: new Set(['HD_ADMIN'] as any),
      hrCats: new Set<string>(),
    };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const category = {
      key: 'LAPTOP',
      active: true,
      subs: ['General'],
      defaultPriority: 'Medium',
      confidential: false,
      queueId: null,
      leadId: 'u2',
      ownerId: 'u2',
      name: 'Laptops',
    };
    const cfg = {
      category: jest.fn().mockReturnValue(category),
      formFields: jest.fn().mockReturnValue([]),
      priorities: jest.fn().mockReturnValue(['Low', 'Medium', 'High', 'Critical']),
      slaFor: jest.fn().mockReturnValue([2, 4]),
      approvalChain: jest.fn().mockReturnValue(null),
      setting: jest.fn().mockReturnValue({}),
      currentVersionId: jest.fn().mockReturnValue(1),
      name: jest.fn((id: string) => id),
      person: jest.fn().mockReturnValue(null),
      helpdeskLabel: jest.fn().mockReturnValue('IT Service Desk'),
    };
    const qb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ nextValue: 123 }),
    };
    const emRepo = {
      sequence: { createQueryBuilder: jest.fn().mockReturnValue(qb), save: jest.fn().mockResolvedValue(undefined) },
      ticket: { create: jest.fn((x: any) => x), insert: jest.fn().mockResolvedValue(undefined) },
      follower: { insert: jest.fn().mockResolvedValue(undefined) },
      approval: { insert: jest.fn().mockResolvedValue(undefined) },
      attachment: { insert: jest.fn().mockResolvedValue(undefined) },
      event: { insert: jest.fn().mockResolvedValue(undefined) },
    };
    const em = {
      getRepository: jest.fn((entity: any) => {
        if (entity === SequenceEntity) return emRepo.sequence;
        if (entity === TicketEntity) return emRepo.ticket;
        if (entity === FollowerEntity) return emRepo.follower;
        if (entity === AttachmentEntity) return emRepo.attachment;
        if (entity === EventEntity) return emRepo.event;
        return emRepo.approval;
      }),
    };
    const loader = {
      ds: {
        transaction: jest.fn((cb: any) => cb(em)),
        getRepository: jest.fn((entity: any) =>
          entity === TicketEntity
            ? { findOne: jest.fn().mockResolvedValue({ key: 'IT-000123', resolutionDue: new Date('2026-11-26T07:17:59.000Z') }) }
            : {},
        ),
      },
    };
    const cover = {
      cover: jest.fn().mockResolvedValue({ asg: 'u2', ladderBase: 0, coverFor: null, unattended: false, event: null }),
      hdAdmins: jest.fn().mockReturnValue(['u20']),
    };
    const events = { emitTicketEvent: jest.fn().mockResolvedValue(undefined) };
    const providers = { for: jest.fn().mockReturnValue({ onCreated: jest.fn().mockResolvedValue(undefined) }) };
    const service = new TicketCreateService(loader as any, {} as any, cfg as any, events as any, providers as any, audit as any, cover as any);

    const result = await service.create(principal, {
      helpdesk: 'IT',
      fields: { cat: 'LAPTOP', sub: 'General', title: 'Broken laptop', desc: 'Sensitive description' },
    });

    expect(result.key).toBe('IT-000123');
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [actorId, action, summary, opts] = audit.record.mock.calls[0];
    expect(actorId).toBe('u1');
    expect(action).toBe('ticket.create');
    expect(summary).toContain('IT-000123');
    expect(opts.target).toBe('IT-000123');
    expect(opts.detail).toMatchObject({ ticket: 'IT-000123', helpdesk: 'IT', category: 'LAPTOP', status: 'New', assigneeId: 'u2' });
    expect(JSON.stringify(opts.detail)).not.toContain('Sensitive description');
  });
});
