import {
  normalizeDomain,
  normalizeName
} from '../../../shared/utils/normalize.js';
import { escapeRegex } from '../../../shared/utils/regex.js';
export {
  buildOrganizationSummaryView,
  ORGANIZATION_SUMMARY_PROJECTION
} from '../../../shared/utils/customer-reference.js';
import {
  normalizeNullableString,
  normalizeObjectId,
  toObjectIdIfValid
} from './customer.helpers.js';

export const ORGANIZATION_SORT_ALLOWLIST = Object.freeze([
  'name',
  '-name',
  'domain',
  '-domain',
  'createdAt',
  '-createdAt',
  'updatedAt',
  '-updatedAt'
]);

export const ORGANIZATION_WRITEABLE_FIELDS = Object.freeze([
  'name',
  'domain',
  'notes'
]);

export const ORGANIZATION_BASE_PROJECTION = {
  _id: 1,
  workspaceId: 1,
  name: 1,
  domain: 1,
  notes: 1,
  createdAt: 1,
  updatedAt: 1
};

export const ORGANIZATION_OPTION_PROJECTION = {
  _id: 1,
  name: 1,
  domain: 1
};

const SORT_MAP = Object.freeze({
  name: { nameNormalized: 1, _id: 1 },
  '-name': { nameNormalized: -1, _id: 1 },
  domain: { domain: 1, nameNormalized: 1, _id: 1 },
  '-domain': { domain: -1, nameNormalized: 1, _id: 1 },
  createdAt: { createdAt: 1, _id: 1 },
  '-createdAt': { createdAt: -1, _id: 1 },
  updatedAt: { updatedAt: 1, _id: 1 },
  '-updatedAt': { updatedAt: -1, _id: 1 }
});

const DEFAULT_LIST_SORT = {
  nameNormalized: 1,
  _id: 1
};

export const normalizeNullableDomain = (value) => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  return normalizeDomain(String(value));
};

export const buildOrganizationView = (organization) => ({
  _id: normalizeObjectId(organization._id),
  workspaceId: normalizeObjectId(organization.workspaceId),
  name: organization.name,
  domain: organization.domain || null,
  notes: organization.notes || null,
  createdAt: organization.createdAt,
  updatedAt: organization.updatedAt
});

export const buildOrganizationOptionView = (organization) => ({
  _id: normalizeObjectId(organization._id),
  name: organization.name,
  domain: organization.domain || null
});

export const normalizeOrganizationCreatePayload = (payload = {}) => ({
  name: String(payload.name || '').trim(),
  domain: normalizeNullableDomain(payload.domain),
  notes: normalizeNullableString(payload.notes)
});

export const normalizeOrganizationUpdatePayload = (payload = {}) => {
  const update = {};

  if (Object.prototype.hasOwnProperty.call(payload, 'name')) {
    update.name = String(payload.name || '').trim();
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'domain')) {
    update.domain = normalizeNullableDomain(payload.domain);
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'notes')) {
    update.notes = normalizeNullableString(payload.notes);
  }

  return update;
};

export const buildOrganizationSearchClause = (value) => {
  const normalizedValue = normalizeNullableString(value);
  if (!normalizedValue) {
    return null;
  }

  const nameSearch = normalizeName(normalizedValue);
  const domainSearch = normalizeDomain(normalizedValue);
  const clauses = [];

  if (nameSearch) {
    clauses.push({
      nameNormalized: {
        $regex: escapeRegex(nameSearch),
        $options: 'i'
      }
    });
  }

  if (domainSearch) {
    clauses.push({
      domain: {
        $regex: escapeRegex(domainSearch),
        $options: 'i'
      }
    });
  }

  if (clauses.length === 0) {
    return null;
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
};

export const buildOrganizationListQuery = ({
  workspaceId,
  search = null,
  domain = null
}) => {
  const query = {
    workspaceId: toObjectIdIfValid(workspaceId),
    deletedAt: null
  };

  const normalizedDomain = normalizeNullableDomain(domain);
  if (normalizedDomain) {
    query.domain = normalizedDomain;
  }

  const searchClause = buildOrganizationSearchClause(search);
  if (searchClause) {
    Object.assign(query, searchClause);
  }

  return query;
};

export const buildOrganizationSort = (sort) =>
  SORT_MAP[sort] || DEFAULT_LIST_SORT;
