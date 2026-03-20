import {
  createContactIdentity,
  listContactIdentities,
} from '../services/contact-identities.service.js';

export const listContactIdentitiesController = async (req, res, next) => {
  try {
    const data = await listContactIdentities({
      workspaceId: req.auth.workspaceId,
      contactId: req.params.id,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const createContactIdentityController = async (req, res, next) => {
  try {
    const data = await createContactIdentity({
      workspaceId: req.auth.workspaceId,
      contactId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.contactIdentity.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
