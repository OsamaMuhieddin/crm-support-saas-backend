import { listUsers } from '../services/users.service.js';

export const getUsers = async (req, res, next) => {
  try {
    const data = await listUsers();
    return res.json({ messageKey: 'success.ok', ...data });
  } catch (err) {
    return next(err);
  }
};
