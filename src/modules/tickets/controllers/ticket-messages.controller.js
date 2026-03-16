import {
  createTicketMessage,
  getTicketConversationByTicketId,
  listTicketMessages,
} from '../services/ticket-messages.service.js';

export const getTicketConversationController = async (req, res, next) => {
  try {
    const data = await getTicketConversationByTicketId({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listTicketMessagesController = async (req, res, next) => {
  try {
    const data = await listTicketMessages({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      page: req.query.page,
      limit: req.query.limit,
      type: req.query.type,
      sort: req.query.sort,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const createTicketMessageController = async (req, res, next) => {
  try {
    const data = await createTicketMessage({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      createdByUserId: req.auth.userId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticket.messageCreated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
