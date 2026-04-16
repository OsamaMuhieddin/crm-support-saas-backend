import {
  activateWidget,
  createWidget,
  deactivateWidget,
  getPublicWidgetBootstrap,
  getWidgetById,
  listWidgetOptions,
  listWidgets,
  updateWidget,
} from '../services/widget.service.js';

export const createWidgetController = async (req, res, next) => {
  try {
    const data = await createWidget({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.widget.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listWidgetsController = async (req, res, next) => {
  try {
    const data = await listWidgets({
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

export const listWidgetOptionsController = async (req, res, next) => {
  try {
    const data = await listWidgetOptions({
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

export const getWidgetController = async (req, res, next) => {
  try {
    const data = await getWidgetById({
      workspaceId: req.auth.workspaceId,
      widgetId: req.params.id,
      roleKey: req.member.roleKey,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateWidgetController = async (req, res, next) => {
  try {
    const data = await updateWidget({
      workspaceId: req.auth.workspaceId,
      widgetId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.widget.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const activateWidgetController = async (req, res, next) => {
  try {
    const data = await activateWidget({
      workspaceId: req.auth.workspaceId,
      widgetId: req.params.id,
    });

    return res.json({
      messageKey: 'success.widget.activated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const deactivateWidgetController = async (req, res, next) => {
  try {
    const data = await deactivateWidget({
      workspaceId: req.auth.workspaceId,
      widgetId: req.params.id,
    });

    return res.json({
      messageKey: 'success.widget.deactivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getPublicWidgetBootstrapController = async (req, res, next) => {
  try {
    const data = await getPublicWidgetBootstrap({
      publicKey: req.params.publicKey,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
