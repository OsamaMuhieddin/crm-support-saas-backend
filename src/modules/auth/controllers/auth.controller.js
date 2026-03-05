import {
  changePassword,
  forgotPassword,
  getMe,
  login,
  logout,
  logoutAll,
  refresh,
  resendOtp,
  resetPassword,
  signup,
  verifyEmailAndLogin
} from '../services/auth.service.js';

export const signupController = async (req, res, next) => {
  try {
    await signup(req.body);
    return res.json({ messageKey: 'success.auth.otpSent' });
  } catch (error) {
    return next(error);
  }
};

export const resendOtpController = async (req, res, next) => {
  try {
    await resendOtp(req.body);
    return res.json({ messageKey: 'success.auth.otpResent' });
  } catch (error) {
    return next(error);
  }
};

export const verifyEmailController = async (req, res, next) => {
  try {
    const data = await verifyEmailAndLogin({
      ...req.body,
      ip: req.ip,
      userAgent: req.get('user-agent') || null
    });

    return res.json({
      messageKey: 'success.auth.verified',
      ...data
    });
  } catch (error) {
    return next(error);
  }
};

export const loginController = async (req, res, next) => {
  try {
    const data = await login({
      ...req.body,
      ip: req.ip,
      userAgent: req.get('user-agent') || null
    });

    return res.json({
      messageKey: 'success.auth.loggedIn',
      ...data
    });
  } catch (error) {
    return next(error);
  }
};

export const refreshController = async (req, res, next) => {
  try {
    const data = await refresh(req.body);
    return res.json({ messageKey: 'success.auth.refreshed', ...data });
  } catch (error) {
    return next(error);
  }
};

export const forgotPasswordController = async (req, res, next) => {
  try {
    await forgotPassword(req.body);
    return res.json({ messageKey: 'success.auth.resetOtpSent' });
  } catch (error) {
    return next(error);
  }
};

export const resetPasswordController = async (req, res, next) => {
  try {
    await resetPassword(req.body);
    return res.json({ messageKey: 'success.auth.passwordReset' });
  } catch (error) {
    return next(error);
  }
};

export const meController = async (req, res, next) => {
  try {
    const data = await getMe({
      userId: req.auth.userId,
      sessionId: req.auth.sessionId
    });
    return res.json({ messageKey: 'success.ok', ...data });
  } catch (error) {
    return next(error);
  }
};

export const logoutController = async (req, res, next) => {
  try {
    await logout({ sessionId: req.auth.sessionId });
    return res.json({ messageKey: 'success.auth.loggedOut' });
  } catch (error) {
    return next(error);
  }
};

export const logoutAllController = async (req, res, next) => {
  try {
    await logoutAll({ userId: req.auth.userId });
    return res.json({ messageKey: 'success.auth.loggedOutAll' });
  } catch (error) {
    return next(error);
  }
};

export const changePasswordController = async (req, res, next) => {
  try {
    await changePassword({
      userId: req.auth.userId,
      ...req.body
    });

    return res.json({ messageKey: 'success.auth.passwordChanged' });
  } catch (error) {
    return next(error);
  }
};
