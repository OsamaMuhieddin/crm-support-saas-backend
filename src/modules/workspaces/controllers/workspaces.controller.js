import { listWorkspaces } from '../services/workspaces.service.js';

export const getWorkspaces = async (req, res, next) => {
  try {
    const data = await listWorkspaces();
    return res.json({ messageKey: 'success.ok', ...data });
  } catch (err) {
    return next(err);
  }
};
