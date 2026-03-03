export const NOTIFICATION_TYPE = Object.freeze({
  TICKET_ASSIGNED: 'ticket_assigned',
  TICKET_MENTION: 'ticket_mention',
  TICKET_REPLY: 'ticket_reply',
  SYSTEM: 'system',
  BILLING: 'billing'
});

export const NOTIFICATION_TYPE_VALUES = Object.freeze(
  Object.values(NOTIFICATION_TYPE)
);

