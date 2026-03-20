import { createError } from '../../../shared/errors/createError.js';
import { ContactIdentity } from '../models/contact-identity.model.js';
import {
  buildContactIdentityView,
  CONTACT_IDENTITY_VIEW_PROJECTION,
  normalizeContactIdentityCreatePayload
} from '../utils/contact-identity.helpers.js';
import { toObjectIdIfValid } from '../utils/customer.helpers.js';
import { findContactInWorkspaceOrThrow } from './contacts.service.js';

const throwMappedContactIdentityWriteError = (error) => {
  if (error?.code !== 11000) {
    throw error;
  }

  throw createError('errors.contactIdentity.alreadyExists', 409);
};

export const listContactIdentities = async ({ workspaceId, contactId }) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const contactObjectId = toObjectIdIfValid(contactId);

  await findContactInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    contactId: contactObjectId,
    lean: true,
    projection: '_id'
  });

  const identities = await ContactIdentity.find({
    workspaceId: workspaceObjectId,
    contactId: contactObjectId,
    deletedAt: null
  })
    .sort({ createdAt: 1, _id: 1 })
    .select(CONTACT_IDENTITY_VIEW_PROJECTION)
    .lean();

  return {
    identities: identities.map((identity) => buildContactIdentityView(identity))
  };
};

export const createContactIdentity = async ({
  workspaceId,
  contactId,
  payload
}) => {
  const workspaceObjectId = toObjectIdIfValid(workspaceId);
  const contactObjectId = toObjectIdIfValid(contactId);
  const normalized = normalizeContactIdentityCreatePayload(payload);

  await findContactInWorkspaceOrThrow({
    workspaceId: workspaceObjectId,
    contactId: contactObjectId,
    lean: true,
    projection: '_id'
  });

  try {
    const identity = await ContactIdentity.create({
      workspaceId: workspaceObjectId,
      contactId: contactObjectId,
      type: normalized.type,
      value: normalized.value,
      verifiedAt: null
    });

    return {
      identity: buildContactIdentityView(identity)
    };
  } catch (error) {
    throwMappedContactIdentityWriteError(error);
  }
};
