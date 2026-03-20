import {
  createOrganization,
  getOrganizationById,
  listOrganizationOptions,
  listOrganizations,
  updateOrganization,
} from '../services/organizations.service.js';

export const createOrganizationController = async (req, res, next) => {
  try {
    const data = await createOrganization({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.organization.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listOrganizationsController = async (req, res, next) => {
  try {
    const data = await listOrganizations({
      workspaceId: req.auth.workspaceId,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      domain: req.query.domain,
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

export const listOrganizationOptionsController = async (req, res, next) => {
  try {
    const data = await listOrganizationOptions({
      workspaceId: req.auth.workspaceId,
      q: req.query.q,
      search: req.query.search,
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

export const getOrganizationController = async (req, res, next) => {
  try {
    const data = await getOrganizationById({
      workspaceId: req.auth.workspaceId,
      organizationId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateOrganizationController = async (req, res, next) => {
  try {
    const data = await updateOrganization({
      workspaceId: req.auth.workspaceId,
      organizationId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.organization.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
