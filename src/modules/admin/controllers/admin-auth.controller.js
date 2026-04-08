import {
  getPlatformAdminMe,
  loginPlatformAdmin,
  logoutPlatformAdmin,
  logoutPlatformAdminAllSessions,
  refreshPlatformAdmin,
} from '../services/admin-auth.service.js';

export const adminLoginController = async (req, res, next) => {
  try {
    const data = await loginPlatformAdmin({
      ...req.body,
      ip: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return res.json({
      messageKey: 'success.adminAuth.loggedIn',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const adminRefreshController = async (req, res, next) => {
  try {
    const data = await refreshPlatformAdmin(req.body);

    return res.json({
      messageKey: 'success.adminAuth.refreshed',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const adminMeController = async (req, res, next) => {
  try {
    const data = await getPlatformAdminMe({
      platformAdminId: req.platformAuth.platformAdminId,
      platformSessionId: req.platformAuth.platformSessionId,
    });

    return res.json({
      messageKey: 'success.ok',
      ...data,
    });
  } catch (error) {
    return next(error);
  }
};

export const adminLogoutController = async (req, res, next) => {
  try {
    await logoutPlatformAdmin({
      platformSessionId: req.platformAuth.platformSessionId,
    });

    return res.json({
      messageKey: 'success.adminAuth.loggedOut',
    });
  } catch (error) {
    return next(error);
  }
};

export const adminLogoutAllController = async (req, res, next) => {
  try {
    await logoutPlatformAdminAllSessions({
      platformAdminId: req.platformAuth.platformAdminId,
    });

    return res.json({
      messageKey: 'success.adminAuth.loggedOutAll',
    });
  } catch (error) {
    return next(error);
  }
};
