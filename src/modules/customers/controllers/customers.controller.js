import { listCustomers } from '../services/customers.service.js';

export const getCustomers = async (req, res, next) => {
  try {
    const data = await listCustomers();
    return res.json({ messageKey: 'success.ok', ...data });
  } catch (err) {
    return next(err);
  }
};
