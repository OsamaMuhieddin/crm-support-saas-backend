import {
  assignTicket,
  closeTicket,
  createTicket,
  getTicketById,
  listTickets,
  reopenTicket,
  selfAssignTicket,
  solveTicket,
  unassignTicket,
  updateTicketStatus,
  updateTicket,
} from '../services/tickets.service.js';

export const createTicketController = async (req, res, next) => {
  try {
    const data = await createTicket({
      workspaceId: req.auth.workspaceId,
      createdByUserId: req.auth.userId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticket.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listTicketsController = async (req, res, next) => {
  try {
    const data = await listTickets({
      workspaceId: req.auth.workspaceId,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      status: req.query.status,
      priority: req.query.priority,
      mailboxId: req.query.mailboxId,
      assigneeId: req.query.assigneeId,
      unassigned: req.query.unassigned,
      categoryId: req.query.categoryId,
      tagId: req.query.tagId,
      contactId: req.query.contactId,
      organizationId: req.query.organizationId,
      channel: req.query.channel,
      includeClosed: req.query.includeClosed,
      createdFrom: req.query.createdFrom,
      createdTo: req.query.createdTo,
      updatedFrom: req.query.updatedFrom,
      updatedTo: req.query.updatedTo,
      sort: req.query.sort,
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const getTicketController = async (req, res, next) => {
  try {
    const data = await getTicketById({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
    });

    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const updateTicketController = async (req, res, next) => {
  try {
    const data = await updateTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticket.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const assignTicketController = async (req, res, next) => {
  try {
    const data = await assignTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      currentUserId: req.auth.userId,
      currentRoleKey: req.member.roleKey,
      assigneeId: req.body.assigneeId,
    });

    return res.json({
      messageKey: 'success.ticket.assigned',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const unassignTicketController = async (req, res, next) => {
  try {
    const data = await unassignTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      currentUserId: req.auth.userId,
      currentRoleKey: req.member.roleKey,
    });

    return res.json({
      messageKey: 'success.ticket.unassigned',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const selfAssignTicketController = async (req, res, next) => {
  try {
    const data = await selfAssignTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      currentUserId: req.auth.userId,
    });

    return res.json({
      messageKey: 'success.ticket.selfAssigned',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateTicketStatusController = async (req, res, next) => {
  try {
    const data = await updateTicketStatus({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
      status: req.body.status,
    });

    return res.json({
      messageKey: 'success.ticket.statusUpdated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const solveTicketController = async (req, res, next) => {
  try {
    const data = await solveTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticket.solved',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const closeTicketController = async (req, res, next) => {
  try {
    const data = await closeTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticket.closed',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const reopenTicketController = async (req, res, next) => {
  try {
    const data = await reopenTicket({
      workspaceId: req.auth.workspaceId,
      ticketId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticket.reopened',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
