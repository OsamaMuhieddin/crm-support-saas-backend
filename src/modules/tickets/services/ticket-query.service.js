import { createError } from '../../../shared/errors/createError.js';
import { Ticket } from '../models/ticket.model.js';

export const findTicketInWorkspaceOrThrow = async ({
  workspaceId,
  ticketId,
  lean = false,
  projection = null,
}) => {
  let cursor = Ticket.findOne({
    _id: ticketId,
    workspaceId,
    deletedAt: null,
  });

  if (projection) {
    cursor = cursor.select(projection);
  }

  if (lean) {
    cursor = cursor.lean();
  }

  const ticket = await cursor;

  if (!ticket) {
    throw createError('errors.ticket.notFound', 404);
  }

  return ticket;
};
