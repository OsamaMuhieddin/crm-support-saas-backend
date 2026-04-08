import request from 'supertest';
import app from '../src/app.js';
import { PlatformAdmin } from '../src/modules/platform/models/platform-admin.model.js';
import { PlatformSession } from '../src/modules/platform/models/platform-session.model.js';
import { PLATFORM_ROLES } from '../src/constants/platform-roles.js';
import { hashPlatformPassword } from '../src/modules/admin/services/admin-auth.service.js';
import {
  captureFallbackEmail,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const createPlatformAdmin = async ({
  email = 'platform-admin@example.com',
  password = 'Password123!',
  role = PLATFORM_ROLES.SUPER_ADMIN,
  status = 'active',
} = {}) => {
  const platformAdmin = await PlatformAdmin.create({
    email,
    passwordHash: await hashPlatformPassword(password),
    role,
    status,
  });

  return {
    platformAdmin,
    email,
    password,
  };
};

const createWorkspaceUser = async ({
  email = `workspace-user-${Date.now()}@example.com`,
  password = 'Password123!',
  name = 'Workspace User',
} = {}) => {
  const signup = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: extractOtpCodeFromLogs(signup.logs),
  });

  expect(verify.status).toBe(200);

  return verify.body.tokens.accessToken;
};

describe('Platform admin auth foundation', () => {
  maybeDbTest(
    'login refresh me logout and logout-all use isolated platform sessions',
    async () => {
      const admin = await createPlatformAdmin({
        email: 'admin-flow@example.com',
      });

      const loginResponse = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: admin.email,
          password: admin.password,
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.messageKey).toBe('success.adminAuth.loggedIn');
      expect(loginResponse.body.tokens.accessToken).toBeTruthy();
      expect(loginResponse.body.tokens.refreshToken).toBeTruthy();
      expect(loginResponse.body.platformAdmin.email).toBe(admin.email);

      const meResponse = await request(app)
        .get('/api/admin/auth/me')
        .set(
          'Authorization',
          `Bearer ${loginResponse.body.tokens.accessToken}`
        );

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.messageKey).toBe('success.ok');
      expect(meResponse.body.platformAdmin.role).toBe(
        PLATFORM_ROLES.SUPER_ADMIN
      );
      expect(meResponse.body.session._id).toBeTruthy();

      const refreshResponse = await request(app)
        .post('/api/admin/auth/refresh')
        .send({ refreshToken: loginResponse.body.tokens.refreshToken });

      expect(refreshResponse.status).toBe(200);
      expect(refreshResponse.body.messageKey).toBe(
        'success.adminAuth.refreshed'
      );
      expect(refreshResponse.body.tokens.refreshToken).toBeTruthy();
      expect(refreshResponse.body.tokens.refreshToken).not.toBe(
        loginResponse.body.tokens.refreshToken
      );

      const reuseOldRefresh = await request(app)
        .post('/api/admin/auth/refresh')
        .send({ refreshToken: loginResponse.body.tokens.refreshToken });

      expect(reuseOldRefresh.status).toBe(401);
      expect(reuseOldRefresh.body.messageKey).toBe(
        'errors.platformAuth.sessionRevoked'
      );

      const secondLogin = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: admin.email,
          password: admin.password,
        });

      expect(secondLogin.status).toBe(200);

      const logoutResponse = await request(app)
        .post('/api/admin/auth/logout')
        .set('Authorization', `Bearer ${secondLogin.body.tokens.accessToken}`)
        .send({});

      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.body.messageKey).toBe(
        'success.adminAuth.loggedOut'
      );

      const meAfterLogout = await request(app)
        .get('/api/admin/auth/me')
        .set('Authorization', `Bearer ${secondLogin.body.tokens.accessToken}`);

      expect(meAfterLogout.status).toBe(401);
      expect(meAfterLogout.body.messageKey).toBe(
        'errors.platformAuth.sessionRevoked'
      );

      const thirdLogin = await request(app).post('/api/admin/auth/login').send({
        email: admin.email,
        password: admin.password,
      });
      const fourthLogin = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: admin.email,
          password: admin.password,
        });

      expect(thirdLogin.status).toBe(200);
      expect(fourthLogin.status).toBe(200);

      const logoutAllResponse = await request(app)
        .post('/api/admin/auth/logout-all')
        .set('Authorization', `Bearer ${thirdLogin.body.tokens.accessToken}`)
        .send({});

      expect(logoutAllResponse.status).toBe(200);
      expect(logoutAllResponse.body.messageKey).toBe(
        'success.adminAuth.loggedOutAll'
      );

      const activeSessions = await PlatformSession.countDocuments({
        platformAdminId: admin.platformAdmin._id,
        revokedAt: null,
      });

      expect(activeSessions).toBe(0);

      const meAfterLogoutAll = await request(app)
        .get('/api/admin/auth/me')
        .set('Authorization', `Bearer ${fourthLogin.body.tokens.accessToken}`);

      expect(meAfterLogoutAll.status).toBe(401);
      expect(meAfterLogoutAll.body.messageKey).toBe(
        'errors.platformAuth.sessionRevoked'
      );
    }
  );

  maybeDbTest(
    'admin auth guard protects admin analytics routes and suspended admins cannot log in',
    async () => {
      const supportAdmin = await createPlatformAdmin({
        email: 'guard-support@example.com',
        role: PLATFORM_ROLES.PLATFORM_SUPPORT,
      });
      const analyticsAdmin = await createPlatformAdmin({
        email: 'guard-platform-admin@example.com',
        role: PLATFORM_ROLES.PLATFORM_ADMIN,
      });

      const unauthenticated = await request(app).get('/api/admin/overview');

      expect(unauthenticated.status).toBe(401);
      expect(unauthenticated.body.messageKey).toBe(
        'errors.platformAuth.invalidToken'
      );

      const loginResponse = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: supportAdmin.email,
          password: supportAdmin.password,
        });

      expect(loginResponse.status).toBe(200);

      const overviewResponse = await request(app)
        .get('/api/admin/overview')
        .set(
          'Authorization',
          `Bearer ${loginResponse.body.tokens.accessToken}`
        );

      expect(overviewResponse.status).toBe(403);
      expect(overviewResponse.body.messageKey).toBe(
        'errors.platformAuth.forbiddenRole'
      );

      const analyticsLogin = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: analyticsAdmin.email,
          password: analyticsAdmin.password,
        });

      expect(analyticsLogin.status).toBe(200);

      const platformOverviewResponse = await request(app)
        .get('/api/admin/overview')
        .set(
          'Authorization',
          `Bearer ${analyticsLogin.body.tokens.accessToken}`
        );

      expect(platformOverviewResponse.status).toBe(200);
      expect(platformOverviewResponse.body.overview.report).toBe('overview');

      await createPlatformAdmin({
        email: 'suspended-admin@example.com',
        status: 'suspended',
      });

      const suspendedLogin = await request(app)
        .post('/api/admin/auth/login')
        .send({
          email: 'suspended-admin@example.com',
          password: 'Password123!',
        });

      expect(suspendedLogin.status).toBe(403);
      expect(suspendedLogin.body.messageKey).toBe(
        'errors.platformAuth.adminSuspended'
      );
    }
  );

  maybeDbTest(
    'workspace user tokens cannot access platform admin routes',
    async () => {
      const workspaceAccessToken = await createWorkspaceUser();

      const response = await request(app)
        .get('/api/admin/auth/me')
        .set('Authorization', `Bearer ${workspaceAccessToken}`);

      expect(response.status).toBe(401);
      expect(response.body.messageKey).toBe(
        'errors.platformAuth.invalidToken'
      );
    }
  );
});
