import { t } from '../src/i18n/index.js';

describe('i18n nested interpolation', () => {
  test('translates nested ticket status refs inside interpolated messages', () => {
    expect(
      t('errors.ticket.invalidStatusTransition', 'en', {
        from: { key: 'ticketStatus.closed' },
        to: { key: 'ticketStatus.open' },
      })
    ).toBe('Cannot change ticket status from closed to open.');

    const arabic = t('errors.ticket.invalidStatusTransition', 'ar', {
      from: { key: 'ticketStatus.closed' },
      to: { key: 'ticketStatus.open' },
    });

    expect(arabic).toContain(t('ticketStatus.closed', 'ar'));
    expect(arabic).toContain(t('ticketStatus.open', 'ar'));
  });

  test('translates nested ticket message type refs inside interpolated messages', () => {
    expect(
      t('errors.ticket.closedMessageNotAllowed', 'en', {
        status: { key: 'ticketStatus.closed' },
        type: { key: 'ticketMessageType.public_reply' },
        allowedType: { key: 'ticketMessageType.internal_note' },
      })
    ).toBe(
      'Cannot add a public reply while the ticket is closed. Only internal note is allowed until the ticket is reopened.'
    );
  });
});
