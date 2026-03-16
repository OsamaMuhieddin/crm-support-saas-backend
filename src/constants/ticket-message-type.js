export const TICKET_MESSAGE_TYPE = Object.freeze({
  CUSTOMER_MESSAGE: 'customer_message',
  PUBLIC_REPLY: 'public_reply',
  INTERNAL_NOTE: 'internal_note',
  SYSTEM_EVENT: 'system_event',
});

export const TICKET_MESSAGE_TYPE_VALUES = Object.freeze(
  Object.values(TICKET_MESSAGE_TYPE)
);
