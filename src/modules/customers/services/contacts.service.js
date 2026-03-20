import { createError } from '../../../shared/errors/createError.js';
import { buildPagination } from '../../../shared/utils/pagination.js';
import { Workspace } from '../../workspaces/models/workspace.model.js';
import { Organization } from '../models/organization.model.js';
import { Contact } from '../models/contact.model.js';
import {
  buildContactDetailView,
  buildContactListQuery,
  buildContactListView,
  buildContactOptionView,
  buildContactSort,
  CONTACT_DETAIL_PROJECTION,
  CONTACT_LIST_PROJECTION,
  CONTACT_OPTION_PROJECTION,
  normalizeContactCreatePayload,
  normalizeContactUpdatePayload
} from '../utils/contact.helpers.js';
import {
  normalizeNullableEmailForWriteOrThrow,
  normalizeNullablePhoneForWriteOrThrow,
  normalizeNullableString,
  toObjectIdIfValid
} from '../utils/customer.helpers.js';
import {
  buildOrganizationSummaryView,
  ORGANIZATION_SUMMARY_PROJECTION
} from '../utils/organization.helpers.js';

const findWorkspaceForContactWritesOrThrow = async ({
  workspaceId,
  projection = '_id'
}) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null
  })
    .select(projection)
    .lean();

  if (!workspace) {
    throw createError('errors.workspace.notFound', 404);
  }

  return workspace;
};

export const findContactInWorkspaceOrThrow = async ({
  workspaceId,
  contactId,
  lean = false,
  projection = null
}) => {
  let cursor = Contact.findOne({
    _id: contactId,
    workspaceId,
    deletedAt: null
  });

  if (projection) {
    cursor = cursor.select(projection);
  }

  if (lean) {
    cursor = cursor.lean();
  }

  const contact = await cursor;

  if (!contact) {
    throw createError('errors.contact.notFound', 404);
  }

  return contact;
};

const findOrganizationSummaryInWorkspaceOrThrow = async ({
  workspaceId,
  organizationId
}) => {
  const organization = await Organization.findOne({
    _id: organizationId,
    workspaceId,
    deletedAt: null
  })
    .select(ORGANIZATION_SUMMARY_PROJECTION)
    .lean();

  if (!organization) {
    throw createError('errors.organization.notFound', 404);
  }

  return organization;
};

const loadOrganizationSummaryMap = async ({
  workspaceId,
  organizationIds = []
}) => {
  const safeOrganizationIds = [
    ...new Set((Array.isArray(organizationIds) ? organizationIds : []).filter(Boolean))
  ];

  if (safeOrganizationIds.length === 0) {
    return new Map();
  }

  const organizations = await Organization.find({
    _id: { $in: safeOrganizationIds.map((id) => toObjectIdIfValid(id)) },
    workspaceId,
    deletedAt: null
  })
    .select(ORGANIZATION_SUMMARY_PROJECTION)
    .lean();

  return new Map(
    organizations.map((organization) => [
      String(organization._id),
      buildOrganizationSummaryView(organization)
    ])
  );
};

const loadSingleOrganizationSummary = async ({ workspaceId, organizationId }) => {
  if (!organizationId) {
    return null;
  }

  const organizationsById = await loadOrganizationSummaryMap({
    workspaceId,
    organizationIds: [organizationId]
  });

  return organizationsById.get(String(organizationId)) || null;
};

const resolveOrganizationForWrite = async ({
  workspaceId,
  organizationId
}) => {
  if (organizationId === undefined) {
    return {
      organizationId: undefined,
      organization: undefined
    };
  }

  const normalizedOrganizationId = normalizeNullableString(organizationId);
  if (!normalizedOrganizationId) {
    return {
      organizationId: null,
      organization: null
    };
  }

  const organization = await findOrganizationSummaryInWorkspaceOrThrow({
    workspaceId,
    organizationId: toObjectIdIfValid(normalizedOrganizationId)
  });

  return {
    organizationId: organization._id,
    organization: buildOrganizationSummaryView(organization)
  };
};

const buildHydratedContactList = async ({ workspaceId, contacts, viewBuilder }) => {
  const organizationsById = await loadOrganizationSummaryMap({
    workspaceId,
    organizationIds: contacts.map((contact) => contact.organizationId)
  });

  return contacts.map((contact) =>
    viewBuilder(contact, {
      organization: contact.organizationId
        ? organizationsById.get(String(contact.organizationId)) || null
        : null
    })
  );
};

export const createContact = async ({ workspaceId, payload }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const normalized = normalizeContactCreatePayload(payload);
  normalized.email = normalizeNullableEmailForWriteOrThrow({
    value: payload?.email,
    field: 'email'
  });
  normalized.phone = normalizeNullablePhoneForWriteOrThrow({
    value: payload?.phone,
    field: 'phone'
  });

  await findWorkspaceForContactWritesOrThrow({
    workspaceId: workspaceObjectId
  });

  const resolvedOrganization = await resolveOrganizationForWrite({
    workspaceId: workspaceObjectId,
    organizationId: normalized.organizationId
  });

  const contact = await Contact.create({
    workspaceId: workspaceObjectId,
    fullName: normalized.fullName,
    organizationId:
      resolvedOrganization.organizationId === undefined
        ? null
        : resolvedOrganization.organizationId,
    email: normalized.email ?? null,
    phone: normalized.phone ?? null,
    tags: normalized.tags || [],
    customFields: normalized.customFields ?? null
  });

  return {
    contact: buildContactDetailView(contact, {
      organization: resolvedOrganization.organization || null
    })
  };
};

export const listContacts = async ({
  workspaceId,
  page = 1,
  limit = 20,
  q = null,
  search = null,
  organizationId = null,
  email = null,
  sort = null
}) => {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (safePage - 1) * safeLimit;
  const query = buildContactListQuery({
    workspaceId,
    search: q || search,
    organizationId,
    email
  });
  const sortQuery = buildContactSort(String(sort || '').trim());

  const [total, contacts] = await Promise.all([
    Contact.countDocuments(query),
    Contact.find(query)
      .sort(sortQuery)
      .skip(skip)
      .limit(safeLimit)
      .select(CONTACT_LIST_PROJECTION)
      .lean()
  ]);

  const hydratedContacts = await buildHydratedContactList({
    workspaceId,
    contacts,
    viewBuilder: buildContactListView
  });

  return {
    ...buildPagination({
      page: safePage,
      limit: safeLimit,
      total,
      results: contacts.length
    }),
    contacts: hydratedContacts
  };
};

export const listContactOptions = async ({
  workspaceId,
  q = null,
  search = null,
  organizationId = null,
  email = null,
  limit = 20
}) => {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  const query = buildContactListQuery({
    workspaceId,
    search: q || search,
    organizationId,
    email
  });

  const contacts = await Contact.find(query)
    .sort({ nameNormalized: 1, _id: 1 })
    .limit(safeLimit)
    .select(CONTACT_OPTION_PROJECTION)
    .lean();

  const options = await buildHydratedContactList({
    workspaceId,
    contacts,
    viewBuilder: buildContactOptionView
  });

  return {
    options
  };
};

export const getContactById = async ({ workspaceId, contactId }) => {
  const contact = await findContactInWorkspaceOrThrow({
    workspaceId: toObjectIdIfValid(workspaceId),
    contactId: toObjectIdIfValid(contactId),
    lean: true,
    projection: CONTACT_DETAIL_PROJECTION
  });

  const organization = await loadSingleOrganizationSummary({
    workspaceId,
    organizationId: contact.organizationId
  });

  return {
    contact: buildContactDetailView(contact, { organization })
  };
};

export const updateContact = async ({
  workspaceId,
  contactId,
  payload
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const contactObjectId = toObjectIdIfValid(contactId);
  const normalized = normalizeContactUpdatePayload(payload);

  if (Object.prototype.hasOwnProperty.call(payload || {}, 'email')) {
    normalized.email = normalizeNullableEmailForWriteOrThrow({
      value: payload.email,
      field: 'email'
    });
  }

  if (Object.prototype.hasOwnProperty.call(payload || {}, 'phone')) {
    normalized.phone = normalizeNullablePhoneForWriteOrThrow({
      value: payload.phone,
      field: 'phone'
    });
  }

  await findWorkspaceForContactWritesOrThrow({
    workspaceId: workspaceObjectId
  });

  const contact = await findContactInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    contactId: contactObjectId
  });

  const resolvedOrganization = await resolveOrganizationForWrite({
    workspaceId: workspaceObjectId,
    organizationId: normalized.organizationId
  });

  if (Object.prototype.hasOwnProperty.call(normalized, 'fullName')) {
    contact.fullName = normalized.fullName;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'organizationId')) {
    contact.organizationId = resolvedOrganization.organizationId;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'email')) {
    contact.email = normalized.email;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'phone')) {
    contact.phone = normalized.phone;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'tags')) {
    contact.tags = normalized.tags || [];
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'customFields')) {
    contact.customFields = normalized.customFields ?? null;
  }

  await contact.save();

  const organization =
    resolvedOrganization.organization !== undefined
      ? resolvedOrganization.organization
      : await loadSingleOrganizationSummary({
          workspaceId: workspaceObjectId,
          organizationId: contact.organizationId
        });

  return {
    contact: buildContactDetailView(contact, { organization: organization || null })
  };
};
