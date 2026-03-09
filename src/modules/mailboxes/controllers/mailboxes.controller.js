import {
  activateMailbox,
  createMailbox,
  deactivateMailbox,
  getMailboxById,
  listMailboxOptions,
  listMailboxes,
  setDefaultMailbox,
  updateMailbox,
} from '../services/mailboxes.service.js';

export const createMailboxController = async (req, res, next) => {
  try {
    const data = await createMailbox({
      workspaceId: req.auth.workspaceId,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.mailbox.created',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const listMailboxesController = async (req, res, next) => {
  try {
    const data = await listMailboxes({
      workspaceId: req.auth.workspaceId,
      roleKey: req.member.roleKey,
      page: req.query.page,
      limit: req.query.limit,
      q: req.query.q,
      search: req.query.search,
      isActive: req.query.isActive,
      isDefault: req.query.isDefault,
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

export const listMailboxOptionsController = async (req, res, next) => {
  try {
    const data = await listMailboxOptions({
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

export const getMailboxController = async (req, res, next) => {
  try {
    const data = await getMailboxById({
      workspaceId: req.auth.workspaceId,
      mailboxId: req.params.id,
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

export const updateMailboxController = async (req, res, next) => {
  try {
    const data = await updateMailbox({
      workspaceId: req.auth.workspaceId,
      mailboxId: req.params.id,
      payload: req.body,
    });

    return res.json({
      messageKey: 'success.mailbox.updated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const setDefaultMailboxController = async (req, res, next) => {
  try {
    const data = await setDefaultMailbox({
      workspaceId: req.auth.workspaceId,
      mailboxId: req.params.id,
    });

    return res.json({
      messageKey: 'success.mailbox.defaultSet',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const activateMailboxController = async (req, res, next) => {
  try {
    const data = await activateMailbox({
      workspaceId: req.auth.workspaceId,
      mailboxId: req.params.id,
    });

    return res.json({
      messageKey: 'success.mailbox.activated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const deactivateMailboxController = async (req, res, next) => {
  try {
    const data = await deactivateMailbox({
      workspaceId: req.auth.workspaceId,
      mailboxId: req.params.id,
    });

    return res.json({
      messageKey: 'success.mailbox.deactivated',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

