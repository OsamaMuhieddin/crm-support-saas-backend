import {
  createContact,
  getContactById,
  listContactOptions,
  listContacts,
  updateContact,
} from '../services/contacts.service.js';

export const createContactController = async (req, res, next) => {
  try {
    const data = await createContact({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.contact.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listContactsController = async (req, res, next) => {
  try {
    const data = await listContacts({
      workspaceId: req.auth.workspaceId,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      organizationId: req.query.organizationId,
      email: req.query.email,
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

export const listContactOptionsController = async (req, res, next) => {
  try {
    const data = await listContactOptions({
      workspaceId: req.auth.workspaceId,
      q: req.query.q,
      search: req.query.search,
      organizationId: req.query.organizationId,
      email: req.query.email,
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

export const getContactController = async (req, res, next) => {
  try {
    const data = await getContactById({
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

export const updateContactController = async (req, res, next) => {
  try {
    const data = await updateContact({
      workspaceId: req.auth.workspaceId,
      contactId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.contact.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
