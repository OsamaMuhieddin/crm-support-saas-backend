import {
  activateTicketCategory,
  createTicketCategory,
  deactivateTicketCategory,
  getTicketCategoryById,
  listTicketCategories,
  listTicketCategoryOptions,
  updateTicketCategory,
} from '../services/ticket-categories.service.js';

export const createTicketCategoryController = async (req, res, next) => {
  try {
    const data = await createTicketCategory({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticketCategory.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listTicketCategoriesController = async (req, res, next) => {
  try {
    const data = await listTicketCategories({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      parentId: req.query.parentId,
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

export const listTicketCategoryOptionsController = async (req, res, next) => {
  try {
    const data = await listTicketCategoryOptions({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      q: req.query.q,
      search: req.query.search,
      parentId: req.query.parentId,
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

export const getTicketCategoryController = async (req, res, next) => {
  try {
    const data = await getTicketCategoryById({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      categoryId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateTicketCategoryController = async (req, res, next) => {
  try {
    const data = await updateTicketCategory({
      workspaceId: req.auth.workspaceId,
      categoryId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.ticketCategory.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const activateTicketCategoryController = async (req, res, next) => {
  try {
    const data = await activateTicketCategory({
      workspaceId: req.auth.workspaceId,
      categoryId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticketCategory.activated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const deactivateTicketCategoryController = async (req, res, next) => {
  try {
    const data = await deactivateTicketCategory({
      workspaceId: req.auth.workspaceId,
      categoryId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ticketCategory.deactivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
