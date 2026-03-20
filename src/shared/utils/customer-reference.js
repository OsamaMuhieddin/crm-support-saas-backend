import { normalizeObjectId } from './object-id.js';

export const CONTACT_SUMMARY_PROJECTION = {
  _id: 1,
  organizationId: 1,
  fullName: 1,
  email: 1,
  phone: 1,
};

export const ORGANIZATION_SUMMARY_PROJECTION = {
  _id: 1,
  name: 1,
  domain: 1,
};

export const buildContactSummaryView = (contact) => ({
  _id: normalizeObjectId(contact._id),
  organizationId: contact.organizationId
    ? normalizeObjectId(contact.organizationId)
    : null,
  fullName: contact.fullName,
  email: contact.email || null,
  phone: contact.phone || null,
});

export const buildOrganizationSummaryView = (organization) => ({
  _id: normalizeObjectId(organization._id),
  name: organization.name,
  domain: organization.domain || null,
});
