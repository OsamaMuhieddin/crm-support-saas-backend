import {
  activateTicketTag,
  createTicketTag,
  deactivateTicketTag,
  getTicketTagById,
  listTicketTagOptions,
  listTicketTags,
  updateTicketTag,
} from '../services/ticket-tags.service.js';

export const createTicketTagController = async (req, res, next) => {
  try {
    const data = await createTicketTag({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticketTag.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listTicketTagsController = async (req, res, next) => {
  try {
    const data = await listTicketTags({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      isActive: req.query.isActive,
      includeInactive: req.query.includeInactive,
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

export const listTicketTagOptionsController = async (req, res, next) => {
  try {
    const data = await listTicketTagOptions({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      q: req.query.q,
      search: req.query.search,
      isActive: req.query.isActive,
      includeInactive: req.query.includeInactive,
      limit: req.query.limit,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getTicketTagController = async (req, res, next) => {
  try {
    const data = await getTicketTagById({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      tagId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateTicketTagController = async (req, res, next) => {
  try {
    const data = await updateTicketTag({
      workspaceId: req.auth.workspaceId,
      tagId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticketTag.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const activateTicketTagController = async (req, res, next) => {
  try {
    const data = await activateTicketTag({
      workspaceId: req.auth.workspaceId,
      tagId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticketTag.activated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const deactivateTicketTagController = async (req, res, next) => {
  try {
    const data = await deactivateTicketTag({
      workspaceId: req.auth.workspaceId,
      tagId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticketTag.deactivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
