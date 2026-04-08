import {
  getAdminBillingOverview,
  getAdminMetrics,
  getAdminOverview,
} from '../services/admin.service.js';

export const getAdminOverviewController = async (req, res, next) => {
  try {
    const data = await getAdminOverview({
      platformAdmin: req.platformAdmin,
      query: req.query,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminMetricsController = async (req, res, next) => {
  try {
    const data = await getAdminMetrics({
      platformAdmin: req.platformAdmin,
      query: req.query,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const getAdminBillingOverviewController = async (req, res, next) => {
  try {
    const data = await getAdminBillingOverview({
      platformAdmin: req.platformAdmin,
      query: req.query,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};
