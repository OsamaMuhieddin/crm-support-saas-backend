import { createError } from '../../../shared/errors/createError.js';
import { toObjectIdIfValid } from '../../../shared/utils/object-id.js';
import { BusinessHours } from '../models/business-hours.model.js';
import { SlaPolicy } from '../models/sla-policy.model.js';

export const findBusinessHoursInWorkspaceOrThrow = async ({
  workspaceId,
  businessHoursId,
  projection = null,
}) => {
  const query = {
    _id: toObjectIdIfValid(businessHoursId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  const businessHoursQuery = BusinessHours.findOne(query);

  if (projection) {
    businessHoursQuery.select(projection);
  }

  const businessHours = await businessHoursQuery;

  if (!businessHours) {
    throw createError('errors.sla.businessHoursNotFound', 404);
  }

  return businessHours;
};

export const findSlaPolicyInWorkspaceOrThrow = async ({
  workspaceId,
  policyId,
  projection = null,
  requireActive = false,
}) => {
  const query = {
    _id: toObjectIdIfValid(policyId),
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null,
  };

  const policyQuery = SlaPolicy.findOne(query);

  if (projection) {
    policyQuery.select(projection);
  }

  const policy = await policyQuery;

  if (!policy) {
    throw createError('errors.sla.policyNotFound', 404);
  }

  if (requireActive && !policy.isActive) {
    throw createError('errors.sla.policyInactive', 409);
  }

  return policy;
};
