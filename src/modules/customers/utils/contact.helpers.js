import {
  normalizeEmail,
  normalizeName
} from '../../../shared/utils/normalize.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
export {
  buildContactSummaryView,
  CONTACT_SUMMARY_PROJECTION
} from '../../../shared/utils/customer-reference.js';
import {
  normalizeCustomFields,
  normalizeNullableEmail,
  normalizeNullablePhone,
  normalizeNullableString,
  normalizeObjectId,
  normalizeTagList,
  toObjectIdIfValid
} from './customer.helpers.js';

export const CONTACT_SORT_ALLOWLIST = Object.freeze([
  'fullName',
  '-fullName',
  'email',
  '-email',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt'
]);

export const CONTACT_WRITEABLE_FIELDS = Object.freeze([
  'fullName',
  'organizationId',
  'email',
  'phone',
  'tags',
  'customFields'
]);

export const CONTACT_LIST_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  organizationId: 1,
  fullName: 1,
  email: 1,
  phone: 1,
  tags: 1,
  createdAt: 1,
  updatedAt: 1
};

export const CONTACT_DETAIL_PROJECTION = {
  ...CONTACT_LIST_PROJECTION,
  customFields: 1
};

export const CONTACT_OPTION_PROJECTION = {
  _id: 1,
  organizationId: 1,
  fullName: 1,
  email: 1,
  phone: 1
};

const SORT_MAP = Object.freeze({
  fullName: { nameNormalized: 1, _id: 1 },
  '-fullName': { nameNormalized: -1, _id: 1 },
  email: { emailNormalized: 1, nameNormalized: 1, _id: 1 },
  '-email': { emailNormalized: -1, nameNormalized: 1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 }
});

const DEFAULT_LIST_SORT = {
  nameNormalized: 1,
  _id: 1
};

const cloneCustomFields = (customFields) => {
  if (!customFields || typeof customFields !== 'object' || Array.isArray(customFields)) {
    return null;
  }

  return { ...customFields };
};

const buildBaseContactView = (contact, { organization = null } = {}) => ({
  _id: normalizeObjectId(contact._id),
  workspaceId: normalizeObjectId(contact.workspaceId),
  organizationId: contact.organizationId
    ? normalizeObjectId(contact.organizationId)
    : null,
  organization,
  fullName: contact.fullName,
  email: contact.email || null,
  phone: contact.phone || null,
  tags: Array.isArray(contact.tags) ? [...contact.tags] : [],
  createdAt: contact.createdAt,
  updatedAt: contact.updatedAt
});

export const buildContactListView = (contact, options = {}) =>
  buildBaseContactView(contact, options);

export const buildContactOptionView = (
  contact,
  { organization = null } = {}
) => ({
  _id: normalizeObjectId(contact._id),
  fullName: contact.fullName,
  email: contact.email || null,
  phone: contact.phone || null,
  organizationId: contact.organizationId
    ? normalizeObjectId(contact.organizationId)
    : null,
  organization
});

export const buildContactDetailView = (contact, options = {}) => ({
  ...buildBaseContactView(contact, options),
  customFields: cloneCustomFields(contact.customFields)
});

export const normalizeContactCreatePayload = (payload = {}) => ({
  fullName: String(payload.fullName || '').trim(),
  organizationId: normalizeNullableString(payload.organizationId),
  email: normalizeNullableEmail(payload.email),
  phone: normalizeNullablePhone(payload.phone),
  tags: normalizeTagList(payload.tags) || [],
  customFields: normalizeCustomFields(payload.customFields)
});

export const normalizeContactUpdatePayload = (payload = {}) => {
  const update = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'fullName')) {
    update.fullName = String(payload.fullName || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'organizationId')) {
    update.organizationId = normalizeNullableString(payload.organizationId);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
    update.email = normalizeNullableEmail(payload.email);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'phone')) {
    update.phone = normalizeNullablePhone(payload.phone);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'tags')) {
    update.tags = normalizeTagList(payload.tags) || [];
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'customFields')) {
    update.customFields = normalizeCustomFields(payload.customFields);
  }

  return update;
};

export const buildContactSearchClause = (value) => {
  const normalizedValue = normalizeNullableString(value);
  if (!normalizedValue) {
    return null;
  }

  const nameSearch = normalizeName(normalizedValue);
  const emailSearch = normalizeEmail(normalizedValue);
  const clauses = [];

  if (nameSearch) {
    clauses.push({
      nameNormalized: {
        $regex: escapeRegex(nameSearch),
        $options: 'i'
      }
    });
  }

  if (emailSearch) {
    clauses.push({
      emailNormalized: {
        $regex: escapeRegex(emailSearch),
        $options: 'i'
      }
    });
  }

  if (clauses.length === 0) {
    return null;
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

export const buildContactListQuery = ({
  workspaceId,
  search = null,
  organizationId = null,
  email = null
}) => {
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null
  };

  const normalizedOrganizationId = normalizeNullableString(organizationId);
  if (normalizedOrganizationId) {
    query.organizationId = toObjectIdIfValid(normalizedOrganizationId);
  }

  const normalizedEmail = normalizeNullableEmail(email);
  if (normalizedEmail) {
    query.emailNormalized = normalizedEmail;
  }

  const searchClause = buildContactSearchClause(search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  return query;
};

export const buildContactSort = (sort) => SORT_MAP[sort] || DEFAULT_LIST_SORT;
