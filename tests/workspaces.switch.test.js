import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { User } from '../src/modules/users/models/user.model.js';
import { OtpCode } from '../src/modules/users/models/otp-code.model.js';
import { OTP_PURPOSE } from '../src/constants/otp-purpose.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs
} from './helpers/email-capture.js';

const signupAndCaptureOtp = async ({ email, password = 'Password123!', name }) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs)
  };
};

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = 'Test User'
}) => {
  const signup = await signupAndCaptureOtp({ email, password, name });
  expect(signup.response.status).toBe(200);
  expect(signup.code).toBeTruthy();

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code
  });

  expect(verify.status).toBe(200);

  return {
    email,
    password,
    user: verify.body.user,
    accessToken: verify.body.tokens.accessToken,
    refreshToken: verify.body.tokens.refreshToken,
    workspaceId: verify.body.user.defaultWorkspaceId
  };
};

const createInviteWithToken = async ({ workspaceId, accessToken, email, roleKey }) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, roleKey })
  );

  return {
    response,
    token: extractInviteTokenFromLogs(logs)
  };
};

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

describe('Workspace switching + explicit active workspace context', () => {
  maybeDbTest(
    'user with memberships in two workspaces can switch and old token is invalid',
    async () => {
      const memberUser = await createVerifiedUser({
        email: 'switch-primary-member@example.com'
      });

      const targetOwner = await createVerifiedUser({
        email: 'switch-target-owner@example.com'
      });

      const created = await createInviteWithToken({
        workspaceId: targetOwner.workspaceId,
        accessToken: targetOwner.accessToken,
        email: memberUser.email,
        roleKey: WORKSPACE_ROLES.AGENT
      });

      const acceptResponse = await request(app).post('/api/workspaces/invites/accept').send({
        token: created.token,
        email: memberUser.email
      });

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.messageKey).toBe('success.invite.accepted');
      expect(acceptResponse.body.workspaceId).toBe(targetOwner.workspaceId);

      const loginResponse = await request(app).post('/api/auth/login').send({
        email: memberUser.email,
        password: memberUser.password
      });

      expect(loginResponse.status).toBe(200);
      const oldAccessToken = loginResponse.body.tokens.accessToken;

      const meBeforeSwitch = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldAccessToken}`);
      expect(meBeforeSwitch.status).toBe(200);
      expect(meBeforeSwitch.body.workspace._id).toBe(memberUser.workspaceId);

      const mineResponse = await request(app)
        .get('/api/workspaces/mine')
        .set('Authorization', `Bearer ${oldAccessToken}`);

      expect(mineResponse.status).toBe(200);
      const mineWorkspaceIds = mineResponse.body.memberships.map((item) => item.workspaceId);
      expect(mineWorkspaceIds).toEqual(
        expect.arrayContaining([memberUser.workspaceId, targetOwner.workspaceId])
      );

      const switchResponse = await request(app)
        .post('/api/workspaces/switch')
        .set('Authorization', `Bearer ${oldAccessToken}`)
        .send({ workspaceId: targetOwner.workspaceId });

      expect(switchResponse.status).toBe(200);
      expect(switchResponse.body.messageKey).toBe('success.workspace.switched');
      expect(switchResponse.body.accessToken).toBeTruthy();
      expect(switchResponse.body.workspace._id).toBe(targetOwner.workspaceId);

      const newAccessToken = switchResponse.body.accessToken;
      const switchedTokenPayload = jwt.decode(newAccessToken);
      expect(switchedTokenPayload.wid).toBe(targetOwner.workspaceId);

      const meWithOldToken = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldAccessToken}`);

      expect(meWithOldToken.status).toBe(401);
      expect(meWithOldToken.body.messageKey).toBe('errors.auth.sessionRevoked');

      const meWithNewToken = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${newAccessToken}`);

      expect(meWithNewToken.status).toBe(200);
      expect(meWithNewToken.body.workspace._id).toBe(targetOwner.workspaceId);
    }
  );

  maybeDbTest(
    'verified invite acceptance returns workspaceId and user can switch after login',
    async () => {
      const owner = await createVerifiedUser({
        email: 'switch-verified-owner@example.com'
      });

      const invitee = await createVerifiedUser({
        email: 'switch-verified-invitee@example.com'
      });

      const created = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.email,
        roleKey: WORKSPACE_ROLES.ADMIN
      });

      const acceptResponse = await request(app).post('/api/workspaces/invites/accept').send({
        token: created.token,
        email: invitee.email
      });

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.messageKey).toBe('success.invite.accepted');
      expect(acceptResponse.body.workspaceId).toBe(owner.workspaceId);

      const loginResponse = await request(app).post('/api/auth/login').send({
        email: invitee.email,
        password: invitee.password
      });

      expect(loginResponse.status).toBe(200);
      const currentAccessToken = loginResponse.body.tokens.accessToken;

      const meBeforeSwitch = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${currentAccessToken}`);

      expect(meBeforeSwitch.status).toBe(200);
      expect(meBeforeSwitch.body.workspace._id).toBe(invitee.workspaceId);

      const switchResponse = await request(app)
        .post('/api/workspaces/switch')
        .set('Authorization', `Bearer ${currentAccessToken}`)
        .send({ workspaceId: owner.workspaceId });

      expect(switchResponse.status).toBe(200);
      expect(switchResponse.body.messageKey).toBe('success.workspace.switched');

      const meAfterSwitch = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${switchResponse.body.accessToken}`);

      expect(meAfterSwitch.status).toBe(200);
      expect(meAfterSwitch.body.workspace._id).toBe(owner.workspaceId);
    }
  );

  maybeDbTest(
    'verify-email invite finalization returns workspaceId and requires explicit switch when user already had workspace',
    async () => {
      const existingUser = await createVerifiedUser({
        email: 'switch-existing-unverified@example.com'
      });

      await User.updateOne(
        { _id: existingUser.user._id },
        { $set: { isEmailVerified: false } }
      );

      await OtpCode.updateMany(
        {
          emailNormalized: existingUser.email,
          purpose: OTP_PURPOSE.VERIFY_EMAIL
        },
        {
          $set: {
            lastSentAt: new Date(Date.now() - 60 * 1000)
          }
        }
      );

      const inviter = await createVerifiedUser({
        email: 'switch-finalize-owner@example.com'
      });

      const created = await createInviteWithToken({
        workspaceId: inviter.workspaceId,
        accessToken: inviter.accessToken,
        email: existingUser.email,
        roleKey: WORKSPACE_ROLES.AGENT
      });

      const acceptResult = await captureFallbackEmail(() =>
        request(app).post('/api/workspaces/invites/accept').send({
          token: created.token,
          email: existingUser.email
        })
      );

      expect(acceptResult.response.status).toBe(200);
      expect(acceptResult.response.body.messageKey).toBe(
        'success.invite.acceptRequiresVerification'
      );
      expect(acceptResult.response.body.workspaceId).toBe(inviter.workspaceId);

      const verifyCode = extractOtpCodeFromLogs(acceptResult.logs);
      expect(verifyCode).toBeTruthy();

      const verifyResponse = await request(app).post('/api/auth/verify-email').send({
        email: existingUser.email,
        code: verifyCode,
        inviteToken: created.token
      });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.messageKey).toBe('success.auth.verified');
      expect(verifyResponse.body.workspaceId).toBe(inviter.workspaceId);
      expect(verifyResponse.body.inviteWorkspaceId).toBe(inviter.workspaceId);
      expect(verifyResponse.body.activeWorkspaceId).toBeTruthy();
      expect(verifyResponse.body.tokens.accessToken).toBeTruthy();
      const verifyTokenPayload = jwt.decode(verifyResponse.body.tokens.accessToken);
      expect(verifyTokenPayload.wid).toBe(verifyResponse.body.activeWorkspaceId);

      const meBeforeSwitch = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${verifyResponse.body.tokens.accessToken}`);

      expect(meBeforeSwitch.status).toBe(200);
      expect(meBeforeSwitch.body.workspace._id).toBe(existingUser.workspaceId);

      const switchResponse = await request(app)
        .post('/api/workspaces/switch')
        .set('Authorization', `Bearer ${verifyResponse.body.tokens.accessToken}`)
        .send({ workspaceId: inviter.workspaceId });

      expect(switchResponse.status).toBe(200);
      expect(switchResponse.body.messageKey).toBe('success.workspace.switched');

      const meAfterSwitch = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${switchResponse.body.accessToken}`);

      expect(meAfterSwitch.status).toBe(200);
      expect(meAfterSwitch.body.workspace._id).toBe(inviter.workspaceId);
    }
  );
});
