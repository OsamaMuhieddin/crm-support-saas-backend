import {
  idSchema,
  jsonRequest,
  objectSchema,
  operation,
  ref,
  stringSchema,
} from '../../../docs/openapi/helpers.js';

const email = stringSchema({ format: 'email', maxLength: 320 });
const password = stringSchema({
  minLength: 8,
  maxLength: 128,
  format: 'password',
});
const otpCode = stringSchema({ pattern: '^\\d{4,8}$' });

const authPayload = {
  user: ref('UserSummary'),
  tokens: ref('AuthTokens'),
};

export const authOpenApiPaths = {
  '/auth/signup': {
    post: operation({
      tags: 'Auth',
      summary: 'Request signup email verification OTP',
      operationId: 'signup',
      security: 'public',
      description:
        'Purpose: create or prepare a user signup and send an email verification OTP. Request schema accepts email, password, and optional display name.',
      requestBody: jsonRequest(
        objectSchema(
          {
            email,
            password,
            name: stringSchema({ minLength: 1, maxLength: 160 }),
          },
          { required: ['email', 'password'], additionalProperties: true }
        )
      ),
      success: { messageKey: 'success.auth.otpSent' },
      errors: ['422', '500'],
    }),
  },
  '/auth/resend-otp': {
    post: operation({
      tags: 'Auth',
      summary: 'Resend an OTP',
      operationId: 'resendOtp',
      security: 'public',
      description:
        'Purpose: resend an OTP for a supported purpose. Anti-enumeration: eligible failures may be collapsed to a success response.',
      requestBody: jsonRequest(
        objectSchema(
          {
            email,
            purpose: ref('OtpPurpose'),
          },
          { required: ['email', 'purpose'], additionalProperties: true }
        )
      ),
      success: { messageKey: 'success.auth.otpResent' },
      errors: ['422', '500'],
    }),
  },
  '/auth/verify-email': {
    post: operation({
      tags: 'Auth',
      summary: 'Verify email and create a session',
      operationId: 'verifyEmail',
      security: 'public',
      description:
        'Purpose: verify an email OTP, create a session, and return workspace-scoped tokens. Invite token finalization does not auto-switch active workspace outside this verification flow.',
      requestBody: jsonRequest(
        objectSchema(
          {
            email,
            code: otpCode,
            inviteToken: stringSchema({ minLength: 10, maxLength: 512 }),
          },
          { required: ['email', 'code'], additionalProperties: true }
        )
      ),
      success: {
        messageKey: 'success.auth.verified',
        payload: {
          ...authPayload,
          workspaceId: idSchema('Joined or active workspace id.'),
          activeWorkspaceId: idSchema('Active workspace id.'),
          inviteWorkspaceId: {
            ...idSchema('Invite workspace id.'),
            nullable: true,
          },
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/auth/login': {
    post: operation({
      tags: 'Auth',
      summary: 'Login',
      operationId: 'login',
      security: 'public',
      description:
        'Purpose: authenticate an active verified user and return workspace-scoped tokens for the active session workspace.',
      requestBody: jsonRequest(
        objectSchema(
          {
            email,
            password,
          },
          {
            required: ['email', 'password'],
            additionalProperties: true,
            example: {
              email: 'agent@example.com',
              password: 'StrongPass123!',
            },
          }
        )
      ),
      success: {
        messageKey: 'success.auth.loggedIn',
        payload: authPayload,
        example: {
          messageKey: 'success.auth.loggedIn',
          message: 'Logged in successfully.',
          user: {
            _id: '64f1a6f3b7c9a0a1b2c3d4e5',
            email: 'agent@example.com',
            profile: {
              name: 'Support Agent',
            },
          },
          tokens: {
            accessToken: 'eyJhbGciOi...',
            refreshToken: 'eyJhbGciOi...',
          },
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/auth/refresh': {
    post: operation({
      tags: 'Auth',
      summary: 'Refresh access tokens',
      operationId: 'refreshAuth',
      security: 'public',
      description:
        'Purpose: rotate a refresh token and return a fresh workspace-scoped access token for the session workspace.',
      requestBody: jsonRequest(
        objectSchema(
          {
            refreshToken: stringSchema({ minLength: 1 }),
          },
          { required: ['refreshToken'], additionalProperties: true }
        )
      ),
      success: {
        messageKey: 'success.auth.refreshed',
        payload: {
          tokens: ref('AuthTokens'),
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/auth/forgot-password': {
    post: operation({
      tags: 'Auth',
      summary: 'Request password reset OTP',
      operationId: 'forgotPassword',
      security: 'public',
      description:
        'Purpose: request a reset-password OTP. Anti-enumeration: unknown or ineligible email addresses can still receive a success envelope.',
      requestBody: jsonRequest(
        objectSchema(
          { email },
          { required: ['email'], additionalProperties: true }
        )
      ),
      success: { messageKey: 'success.auth.resetOtpSent' },
      errors: ['422', '500'],
    }),
  },
  '/auth/reset-password': {
    post: operation({
      tags: 'Auth',
      summary: 'Reset password',
      operationId: 'resetPassword',
      security: 'public',
      description:
        'Purpose: reset a user password with a reset OTP. Existing sessions are invalidated after success.',
      requestBody: jsonRequest(
        objectSchema(
          {
            email,
            code: otpCode,
            newPassword: password,
          },
          {
            required: ['email', 'code', 'newPassword'],
            additionalProperties: true,
          }
        )
      ),
      success: { messageKey: 'success.auth.passwordReset' },
      errors: ['401', '422', '500'],
    }),
  },
  '/auth/me': {
    get: operation({
      tags: 'Auth',
      summary: 'Get current user context',
      operationId: 'getMe',
      security: 'user',
      description:
        'Purpose: return the authenticated user, active workspace basics, and roleKey from the current workspace-scoped token.',
      success: {
        payload: {
          user: ref('UserSummary'),
          workspace: ref('WorkspaceSummary'),
          roleKey: stringSchema({
            enum: ['owner', 'admin', 'agent', 'viewer'],
          }),
        },
      },
      errors: ['401', '403', '500'],
    }),
  },
  '/auth/profile': {
    patch: operation({
      tags: 'Auth',
      summary: 'Update current user profile',
      operationId: 'updateProfile',
      security: 'user',
      description:
        'Purpose: update the authenticated user profile. At least one allowed field is required.',
      requestBody: jsonRequest(
        objectSchema(
          {
            name: stringSchema({
              minLength: 1,
              maxLength: 160,
              nullable: true,
            }),
            avatar: stringSchema({ maxLength: 2048, nullable: true }),
          },
          { additionalProperties: false }
        )
      ),
      success: {
        messageKey: 'success.auth.profileUpdated',
        payload: {
          user: ref('UserSummary'),
        },
      },
      errors: ['401', '403', '422', '500'],
    }),
  },
  '/auth/logout': {
    post: operation({
      tags: 'Auth',
      summary: 'Logout current session',
      operationId: 'logout',
      security: 'user',
      description:
        'Purpose: revoke the current session and disconnect related realtime sessions.',
      success: { messageKey: 'success.auth.loggedOut' },
      errors: ['401', '403', '500'],
    }),
  },
  '/auth/logout-all': {
    post: operation({
      tags: 'Auth',
      summary: 'Logout all sessions',
      operationId: 'logoutAll',
      security: 'user',
      description:
        'Purpose: revoke all sessions for the authenticated user and disconnect related realtime sessions.',
      success: { messageKey: 'success.auth.loggedOutAll' },
      errors: ['401', '403', '500'],
    }),
  },
  '/auth/change-password': {
    post: operation({
      tags: 'Auth',
      summary: 'Change password',
      operationId: 'changePassword',
      security: 'user',
      description:
        'Purpose: change the authenticated user password. New password must differ from the current password and all user sessions are revoked after success.',
      requestBody: jsonRequest(
        objectSchema(
          {
            currentPassword: password,
            newPassword: password,
          },
          {
            required: ['currentPassword', 'newPassword'],
            additionalProperties: true,
          }
        )
      ),
      success: { messageKey: 'success.auth.passwordChanged' },
      errors: ['401', '403', '422', '500'],
    }),
  },
};
