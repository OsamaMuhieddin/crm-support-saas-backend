import {
  activateSlaPolicy,
  createBusinessHours,
  createSlaPolicy,
  deactivateSlaPolicy,
  getBusinessHoursById,
  getSlaPolicyById,
  getSlaSummary,
  listBusinessHours,
  listBusinessHoursOptions,
  listSlaPolicies,
  listSlaPolicyOptions,
  setDefaultSlaPolicy,
  updateBusinessHours,
  updateSlaPolicy,
} from '../services/sla.service.js';

export const listBusinessHoursController = async (req, res, next) => {
  try {
    const data = await listBusinessHours({
      workspaceId: req.auth.workspaceId,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
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

export const listBusinessHoursOptionsController = async (req, res, next) => {
  try {
    const data = await listBusinessHoursOptions({
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

export const getBusinessHoursController = async (req, res, next) => {
  try {
    const data = await getBusinessHoursById({
      workspaceId: req.auth.workspaceId,
      businessHoursId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const createBusinessHoursController = async (req, res, next) => {
  try {
    const data = await createBusinessHours({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.sla.businessHours.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateBusinessHoursController = async (req, res, next) => {
  try {
    const data = await updateBusinessHours({
      workspaceId: req.auth.workspaceId,
      businessHoursId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.sla.businessHours.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listSlaPoliciesController = async (req, res, next) => {
  try {
    const data = await listSlaPolicies({
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

export const listSlaPolicyOptionsController = async (req, res, next) => {
  try {
    const data = await listSlaPolicyOptions({
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

export const getSlaPolicyController = async (req, res, next) => {
  try {
    const data = await getSlaPolicyById({
      workspaceId: req.auth.workspaceId,
      policyId: req.params.id,
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

export const createSlaPolicyController = async (req, res, next) => {
  try {
    const data = await createSlaPolicy({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.sla.policy.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const updateSlaPolicyController = async (req, res, next) => {
  try {
    const data = await updateSlaPolicy({
      workspaceId: req.auth.workspaceId,
      policyId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.sla.policy.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const activateSlaPolicyController = async (req, res, next) => {
  try {
    const data = await activateSlaPolicy({
      workspaceId: req.auth.workspaceId,
      policyId: req.params.id,
    });

    return res.json({
      messageKey: 'success.sla.policy.activated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const deactivateSlaPolicyController = async (req, res, next) => {
  try {
    const data = await deactivateSlaPolicy({
      workspaceId: req.auth.workspaceId,
      policyId: req.params.id,
      replacementPolicyId: req.body?.replacementPolicyId,
    });

    return res.json({
      messageKey: 'success.sla.policy.deactivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const setDefaultSlaPolicyController = async (req, res, next) => {
  try {
    const data = await setDefaultSlaPolicy({
      workspaceId: req.auth.workspaceId,
      policyId: req.params.id,
    });

    return res.json({
      messageKey: 'success.sla.policy.defaultSet',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getSlaSummaryController = async (req, res, next) => {
  try {
    const data = await getSlaSummary({
      workspaceId: req.auth.workspaceId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
