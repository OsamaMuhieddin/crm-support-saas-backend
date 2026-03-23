import mongoose from 'mongoose';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import {
  collectBusinessHoursScheduleIssues,
  normalizeWeeklySchedule,
} from '../src/modules/sla/utils/business-hours.helpers.js';
import {
  getSlaRuleForPriority,
  resolveSlaSelection,
} from '../src/modules/sla/utils/sla-policy.helpers.js';

describe('SLA helpers and schema foundations', () => {
  test('normalizeWeeklySchedule fills missing days and sorts windows', () => {
    const normalized = normalizeWeeklySchedule([
      {
        dayOfWeek: 1,
        isOpen: true,
        windows: [
          { start: '13:00', end: '17:00' },
          { start: '09:00', end: '12:00' },
        ],
      },
      {
        dayOfWeek: 5,
        isOpen: false,
        windows: [],
      },
    ]);

    expect(normalized).toHaveLength(7);
    expect(normalized[0]).toEqual({
      dayOfWeek: 0,
      isOpen: false,
      windows: [],
    });
    expect(normalized[1].windows).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
    expect(normalized[5]).toEqual({
      dayOfWeek: 5,
      isOpen: false,
      windows: [],
    });
  });

  test('collectBusinessHoursScheduleIssues catches overlapping and invalid windows', () => {
    const issues = collectBusinessHoursScheduleIssues([
      {
        dayOfWeek: 1,
        isOpen: true,
        windows: [
          { start: '09:00', end: '12:00' },
          { start: '11:30', end: '14:00' },
        ],
      },
      {
        dayOfWeek: 1,
        isOpen: true,
        windows: [{ start: '18:00', end: '17:00' }],
      },
    ]);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'weeklySchedule[0].windows',
          messageKey: 'errors.validation.invalidTime',
        }),
        expect.objectContaining({
          field: 'weeklySchedule[1].dayOfWeek',
          messageKey: 'errors.validation.duplicateValues',
        }),
        expect.objectContaining({
          field: 'weeklySchedule[1].windows[0]',
          messageKey: 'errors.validation.invalidTime',
        }),
      ])
    );
  });

  test('resolveSlaSelection prefers mailbox override over workspace default', () => {
    expect(
      resolveSlaSelection({
        mailbox: { slaPolicyId: 'mailbox-policy-id' },
        workspace: { defaultSlaPolicyId: 'workspace-policy-id' },
      })
    ).toEqual({
      policyId: 'mailbox-policy-id',
      source: 'mailbox',
    });

    expect(
      resolveSlaSelection({
        mailbox: { slaPolicyId: null },
        workspace: { defaultSlaPolicyId: 'workspace-policy-id' },
      })
    ).toEqual({
      policyId: 'workspace-policy-id',
      source: 'workspace_default',
    });
  });

  test('getSlaRuleForPriority returns active SLA targets only', () => {
    const rule = getSlaRuleForPriority({
      priority: 'high',
      policy: {
        rulesByPriority: {
          high: {
            firstResponseMinutes: 30,
            resolutionMinutes: 240,
            nextResponseMinutes: 90,
          },
        },
      },
    });

    expect(rule).toEqual({
      firstResponseMinutes: 30,
      resolutionMinutes: 240,
    });
  });

  test('ticket SLA schema exposes deferred runtime fields with null defaults', async () => {
    const ticket = new Ticket({
      workspaceId: new mongoose.Types.ObjectId(),
      mailboxId: new mongoose.Types.ObjectId(),
      number: 1,
      subject: 'SLA foundation ticket',
      contactId: new mongoose.Types.ObjectId(),
    });

    await ticket.validate();

    expect(ticket.sla.businessHoursId).toBeNull();
    expect(ticket.sla.policySource).toBeNull();
    expect(ticket.sla.firstResponseTargetMinutes).toBeNull();
    expect(ticket.sla.resolutionTargetMinutes).toBeNull();
    expect(ticket.sla.firstResponseRemainingMinutes).toBeNull();
    expect(ticket.sla.resolutionRemainingMinutes).toBeNull();
    expect(ticket.sla.resolutionPausedAt).toBeNull();
    expect(ticket.sla.resolutionPausedReason).toBeNull();
  });
});
