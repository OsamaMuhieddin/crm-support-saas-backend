import request from 'supertest';
import app from '../src/app.js';
import { OtpCode } from '../src/modules/users/models/otp-code.model.js';
import { Session } from '../src/modules/users/models/session.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import { OTP_PURPOSE } from '../src/constants/otp-purpose.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractOtpCodeFromLogs
} from './helpers/email-capture.js';

const signupAndCaptureOtp = async ({ email, password = 'Password123!', name }) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  const code = extractOtpCodeFromLogs(logs);
  return { response, code };
};

const verifyEmailWithCode = async ({ email, code, inviteToken }) =>
  request(app)
    .post('/api/auth/verify-email')
    .send({ email, code, inviteToken });

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = 'Test User'
}) => {
  const { response: signupResponse, code } = await signupAndCaptureOtp({
    email,
    password,
    name
  });

  expect(signupResponse.status).toBe(200);
  expect(code).toBeTruthy();

  const verifyResponse = await verifyEmailWithCode({ email, code });
  expect(verifyResponse.status).toBe(200);

  return {
    verifyResponse,
    accessToken: verifyResponse.body.tokens.accessToken,
    refreshToken: verifyResponse.body.tokens.refreshToken,
    workspaceId: verifyResponse.body.user.defaultWorkspaceId
  };
};

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

describe('Auth + OTP flows', () => {
  maybeDbTest('signup creates OTP', async () => {
    const email = 'new-user@example.com';

    const { response, code } = await signupAndCaptureOtp({
      email,
      password: 'Password123!'
    });

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.auth.otpSent');
    expect(code).toBeTruthy();

    const otp = await OtpCode.findOne({ emailNormalized: email });
    expect(otp).toBeTruthy();
    expect(otp.purpose).toBe(OTP_PURPOSE.VERIFY_EMAIL);
  });

  maybeDbTest('signup for existing unverified user returns success and reissues OTP', async () => {
    const email = 'existing-unverified@example.com';

    const firstSignup = await signupAndCaptureOtp({
      email,
      password: 'Password123!'
    });

    expect(firstSignup.response.status).toBe(200);

    await OtpCode.updateMany(
      { emailNormalized: email, purpose: OTP_PURPOSE.VERIFY_EMAIL },
      {
        $set: {
          lastSentAt: new Date(Date.now() - 60 * 1000)
        }
      }
    );

    const secondSignup = await signupAndCaptureOtp({
      email,
      password: 'Password123!'
    });

    expect(secondSignup.response.status).toBe(200);
    expect(secondSignup.response.body.messageKey).toBe('success.auth.otpSent');

    const otpCount = await OtpCode.countDocuments({
      emailNormalized: email,
      purpose: OTP_PURPOSE.VERIFY_EMAIL
    });

    expect(otpCount).toBe(2);
  });

  maybeDbTest('verify-email creates workspace + membership + tokens', async () => {
    const email = 'verify-flow@example.com';
    const password = 'Password123!';

    const { code } = await signupAndCaptureOtp({ email, password, name: 'Owner User' });

    const response = await verifyEmailWithCode({ email, code });

    expect(response.status).toBe(200);
    expect(response.body.messageKey).toBe('success.auth.verified');
    expect(response.body.tokens.accessToken).toBeTruthy();
    expect(response.body.tokens.refreshToken).toBeTruthy();

    const user = await User.findOne({ emailNormalized: email });
    expect(user.isEmailVerified).toBe(true);
    expect(user.defaultWorkspaceId).toBeTruthy();

    const workspace = await Workspace.findById(user.defaultWorkspaceId);
    expect(workspace).toBeTruthy();

    const member = await WorkspaceMember.findOne({
      workspaceId: workspace._id,
      userId: user._id
    });

    expect(member).toBeTruthy();
    expect(member.roleKey).toBe(WORKSPACE_ROLES.OWNER);
  });

  maybeDbTest('login is blocked until email is verified', async () => {
    const email = 'unverified-login@example.com';
    const password = 'Password123!';

    await signupAndCaptureOtp({ email, password });

    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(loginResponse.status).toBe(403);
    expect(loginResponse.body.messageKey).toBe('errors.auth.emailNotVerified');
  });

  maybeDbTest('refresh rotates refresh token', async () => {
    const email = 'refresh-user@example.com';

    const verified = await createVerifiedUser({ email });

    const refreshResponse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verified.refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.messageKey).toBe('success.auth.refreshed');
    expect(refreshResponse.body.tokens.refreshToken).toBeTruthy();
    expect(refreshResponse.body.tokens.refreshToken).not.toBe(verified.refreshToken);

    const oldTokenReuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verified.refreshToken });

    expect(oldTokenReuse.status).toBe(401);
    expect(oldTokenReuse.body.messageKey).toBe('errors.auth.sessionRevoked');
  });

  maybeDbTest('logout revokes current session', async () => {
    const email = 'logout-user@example.com';

    const verified = await createVerifiedUser({ email });

    const logoutResponse = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({});

    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.messageKey).toBe('success.auth.loggedOut');

    const meResponse = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verified.accessToken}`);

    expect(meResponse.status).toBe(401);
    expect(meResponse.body.messageKey).toBe('errors.auth.sessionRevoked');
  });

  maybeDbTest('reset-password updates password and revokes sessions', async () => {
    const email = 'reset-user@example.com';
    const oldPassword = 'Password123!';
    const newPassword = 'NewPassword456!';

    const verified = await createVerifiedUser({ email, password: oldPassword });

    const forgotResult = await captureFallbackEmail(() =>
      request(app).post('/api/auth/forgot-password').send({ email })
    );

    expect(forgotResult.response.status).toBe(200);
    expect(forgotResult.response.body.messageKey).toBe('success.auth.resetOtpSent');

    const resetCode = extractOtpCodeFromLogs(forgotResult.logs);
    expect(resetCode).toBeTruthy();

    const resetResponse = await request(app).post('/api/auth/reset-password').send({
      email,
      code: resetCode,
      newPassword
    });

    expect(resetResponse.status).toBe(200);
    expect(resetResponse.body.messageKey).toBe('success.auth.passwordReset');

    const refreshAfterReset = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: verified.refreshToken });

    expect(refreshAfterReset.status).toBe(401);
    expect(refreshAfterReset.body.messageKey).toBe('errors.auth.sessionRevoked');

    const loginNewPassword = await request(app)
      .post('/api/auth/login')
      .send({ email, password: newPassword });

    expect(loginNewPassword.status).toBe(200);
    expect(loginNewPassword.body.messageKey).toBe('success.auth.loggedIn');
  });

  maybeDbTest(
    'reset-password rejects same password and consumes OTP code',
    async () => {
      const email = 'reset-same-password@example.com';
      const password = 'Password123!';

      await createVerifiedUser({ email, password });

      const forgotResult = await captureFallbackEmail(() =>
        request(app).post('/api/auth/forgot-password').send({ email })
      );

      expect(forgotResult.response.status).toBe(200);
      expect(forgotResult.response.body.messageKey).toBe(
        'success.auth.resetOtpSent'
      );

      const resetCode = extractOtpCodeFromLogs(forgotResult.logs);
      expect(resetCode).toBeTruthy();

      const samePasswordResponse = await request(app)
        .post('/api/auth/reset-password')
        .send({
          email,
          code: resetCode,
          newPassword: password
        });

      expect(samePasswordResponse.status).toBe(422);
      expect(samePasswordResponse.body.messageKey).toBe(
        'errors.validation.failed'
      );
      expect(samePasswordResponse.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'newPassword',
            messageKey: 'errors.auth.passwordMustDiffer'
          })
        ])
      );

      const reusedCodeResponse = await request(app)
        .post('/api/auth/reset-password')
        .send({
          email,
          code: resetCode,
          newPassword: 'AnotherPassword456!'
        });

      expect(reusedCodeResponse.status).toBe(422);
      expect(reusedCodeResponse.body.messageKey).toBe(
        'errors.validation.failed'
      );
      expect(reusedCodeResponse.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'code',
            messageKey: 'errors.otp.invalid'
          })
        ])
      );
    }
  );

  maybeDbTest('resend-otp within cooldown returns resendTooSoon', async () => {
    const email = 'otp-cooldown@example.com';

    const signupResult = await signupAndCaptureOtp({
      email,
      password: 'Password123!'
    });
    expect(signupResult.response.status).toBe(200);

    await OtpCode.updateMany(
      { emailNormalized: email, purpose: OTP_PURPOSE.VERIFY_EMAIL },
      {
        $set: {
          lastSentAt: new Date(Date.now() - 60 * 1000)
        }
      }
    );

    const first = await request(app).post('/api/auth/resend-otp').send({
      email,
      purpose: OTP_PURPOSE.VERIFY_EMAIL
    });

    expect(first.status).toBe(200);

    const second = await request(app).post('/api/auth/resend-otp').send({
      email,
      purpose: OTP_PURPOSE.VERIFY_EMAIL
    });

    expect(second.status).toBe(429);
    expect(second.body.messageKey).toBe('errors.otp.resendTooSoon');
  });

  maybeDbTest('resend-otp exceeding window limit returns rateLimited', async () => {
    const email = 'otp-window@example.com';

    const signupResult = await signupAndCaptureOtp({
      email,
      password: 'Password123!'
    });
    expect(signupResult.response.status).toBe(200);

    await OtpCode.updateMany(
      { emailNormalized: email, purpose: OTP_PURPOSE.VERIFY_EMAIL },
      {
        $set: {
          lastSentAt: new Date(Date.now() - 60 * 1000)
        }
      }
    );

    const first = await request(app).post('/api/auth/resend-otp').send({
      email,
      purpose: OTP_PURPOSE.VERIFY_EMAIL
    });

    expect(first.status).toBe(200);

    await OtpCode.updateMany(
      { emailNormalized: email, purpose: OTP_PURPOSE.VERIFY_EMAIL },
      {
        $set: {
          lastSentAt: new Date(Date.now() - 60 * 1000)
        }
      }
    );

    const second = await request(app).post('/api/auth/resend-otp').send({
      email,
      purpose: OTP_PURPOSE.VERIFY_EMAIL
    });

    expect(second.status).toBe(429);
    expect(second.body.messageKey).toBe('errors.otp.rateLimited');
  });

  maybeDbTest('logout-all revokes all sessions', async () => {
    const email = 'logout-all@example.com';
    const password = 'Password123!';

    const verified = await createVerifiedUser({ email, password });

    const secondLogin = await request(app)
      .post('/api/auth/login')
      .send({ email, password });

    expect(secondLogin.status).toBe(200);

    const logoutAllResponse = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${verified.accessToken}`)
      .send({});

    expect(logoutAllResponse.status).toBe(200);

    const user = await User.findOne({ emailNormalized: email });
    const activeSessions = await Session.countDocuments({
      userId: user._id,
      revokedAt: null
    });
    expect(activeSessions).toBe(0);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${verified.accessToken}`);

    expect(me.status).toBe(401);
  });
});
