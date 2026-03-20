import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { Organization } from '../models/organization.model.js';
import {
  normalizeNullableDomainForWriteOrThrow,
  toObjectIdIfValid
} from '../utils/customer.helpers.js';
import {
  buildOrganizationListQuery,
  buildOrganizationOptionView,
  buildOrganizationSort,
  buildOrganizationView,
  normalizeOrganizationCreatePayload,
  normalizeOrganizationUpdatePayload,
  ORGANIZATION_BASE_PROJECTION,
  ORGANIZATION_OPTION_PROJECTION,
} from '../utils/organization.helpers.js';

const findWorkspaceForOrganizationWritesOrThrow = async ({
  workspaceId,
  projection = '_id',
}) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select(projection)
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

const findOrganizationInWorkspaceOrThrow = async ({
  workspaceId,
  organizationId,
  lean = false,
  projection = null,
}) => {
  let cursor = Organization.findOne({
    _id: organizationId,
    workspaceId,
    deletedAt: null,
  });

  if (projection) {
    cursor = cursor.select(projection);
  }

  if (lean) {
    cursor = cursor.lean();
  }

  const organization = await cursor;

  if (!organization) {
    throw createError('errors.organization.notFound', 404);
  }

  return organization;
};

export const createOrganization = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeOrganizationCreatePayload(payload);
  normalized.domain = normalizeNullableDomainForWriteOrThrow({
    value: payload?.domain,
    field: 'domain'
  });

  await findWorkspaceForOrganizationWritesOrThrow({
    workspaceId: workspaceObjectId,
  });

  const organization = await Organization.create({
    workspaceId: workspaceObjectId,
    ...normalized,
  });

  return {
    organization: buildOrganizationView(organization),
  };
};

export const listOrganizations = async ({
  workspaceId,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  domain = null,
  sort = null,
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const query = buildOrganizationListQuery({
    workspaceId,
    search: q || search,
    domain,
  });
  const sortQuery = buildOrganizationSort(String(sort || '').trim());

  const [total, organizations] = await Promise.all([
    Organization.countDocuments(query),
    Organization.find(query)
      .sort(sortQuery)
      .skip(skip)
      .limit(safeLimit)
      .select(ORGANIZATION_BASE_PROJECTION)
      .lean(),
  ]);

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: organizations.length,
    }),
    organizations: organizations.map((organization) =>
      buildOrganizationView(organization)
    ),
  };
};

export const listOrganizationOptions = async ({
  workspaceId,
  q = null,
  search = null,
  limit = 20,
}) => {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const query = buildOrganizationListQuery({
    workspaceId,
    search: q || search,
  });

  const options = await Organization.find(query)
    .sort({ nameNormalized: 1, _id: 1 })
    .limit(safeLimit)
    .select(ORGANIZATION_OPTION_PROJECTION)
    .lean();

  return {
    options: options.map((organization) =>
      buildOrganizationOptionView(organization)
    ),
  };
};

export const getOrganizationById = async ({ workspaceId, organizationId }) => {
  const organization = await findOrganizationInWorkspaceOrThrow({
    workspaceId: toObjectIdIfValid(workspaceId),
    organizationId: toObjectIdIfValid(organizationId),
    lean: true,
    projection: ORGANIZATION_BASE_PROJECTION,
  });

  return {
    organization: buildOrganizationView(organization),
  };
};

export const updateOrganization = async ({
  workspaceId,
  organizationId,
  payload,
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const organizationObjectId = toObjectIdIfValid(organizationId);
  const normalized = normalizeOrganizationUpdatePayload(payload);

  if (Object.prototype.hasOwnProperty.call(payload || {}, 'domain')) {
    normalized.domain = normalizeNullableDomainForWriteOrThrow({
      value: payload.domain,
      field: 'domain'
    });
  }

  await findWorkspaceForOrganizationWritesOrThrow({
    workspaceId: workspaceObjectId,
  });

  const organization = await findOrganizationInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    organizationId: organizationObjectId,
  });

  for (const [key, value] of Object.entries(normalized)) {
    organization[key] = value;
  }

  await organization.save();

  return {
    organization: buildOrganizationView(organization),
  };
};
