import { getHealth } from '../services/health.service.js';

export const healthCheck = async (req, res, next) => {
  try {
    const data = await getHealth();
    return res.json({ messageKey: 'success.ok', ...data });
  } catch (err) {
    return next(err);
  }
};
