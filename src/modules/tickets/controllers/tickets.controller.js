import { listTickets } from '../services/tickets.service.js';

export const getTickets = async (req, res, next) => {
  try {
    const data = await listTickets();
    return res.json({ messageKey: 'success.ok', ...data });
  } catch (err) {
    return next(err);
  }
};
