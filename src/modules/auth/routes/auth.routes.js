import { Router } from 'express';
import validate from '../../../shared/middlewares/validate.js';
import requireAuth from '../../../shared/middlewares/requireAuth.js';
import requireActiveUser from '../../../shared/middlewares/requireActiveUser.js';
import {
  changePasswordController,
  forgotPasswordController,
  loginController,
  logoutAllController,
  logoutController,
  meController,
  refreshController,
  resendOtpController,
  resetPasswordController,
  signupController,
  updateProfileController,
  verifyEmailController,
} from '../controllers/auth.controller.js';
import {
  changePasswordValidator,
  forgotPasswordValidator,
  loginValidator,
  refreshValidator,
  resendOtpValidator,
  resetPasswordValidator,
  signupValidator,
  updateProfileValidator,
  verifyEmailValidator,
} from '../validators/auth.validators.js';

const router = Router();

router.post('/signup', validate(signupValidator), signupController);
router.post('/resend-otp', validate(resendOtpValidator), resendOtpController);
router.post(
  '/verify-email',
  validate(verifyEmailValidator),
  verifyEmailController
);
router.post('/login', validate(loginValidator), loginController);
router.post('/refresh', validate(refreshValidator), refreshController);
router.post(
  '/forgot-password',
  validate(forgotPasswordValidator),
  forgotPasswordController
);
router.post(
  '/reset-password',
  validate(resetPasswordValidator),
  resetPasswordController
);

router.get('/me', requireAuth, requireActiveUser, meController);
router.patch(
  '/profile',
  requireAuth,
  requireActiveUser,
  validate(updateProfileValidator),
  updateProfileController
);
router.post('/logout', requireAuth, requireActiveUser, logoutController);
router.post('/logout-all', requireAuth, requireActiveUser, logoutAllController);
router.post(
  '/change-password',
  requireAuth,
  requireActiveUser,
  validate(changePasswordValidator),
  changePasswordController
);

export default router;
