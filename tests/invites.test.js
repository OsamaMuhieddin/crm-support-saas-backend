import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import { WorkspaceInvite } from '../src/modules/workspaces/models/workspace-invite.model.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { OtpCode } from '../src/modules/users/models/otp-code.model.js';
import { OTP_PURPOSE } from '../src/constants/otp-purpose.js';
import { MEMBER_STATUS } from '../src/constants/member-status.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { INVITE_STATUS } from '../src/constants/invite-status.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import {
  patchPlanForTests,
  setWorkspaceBillingPlanForTests,
} from './helpers/billing.js';

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name,
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs),
  };
};

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = 'Test User',
}) => {
  const signup = await signupAndCaptureOtp({ email, password, name });
  expect(signup.response.status).toBe(200);
  expect(signup.code).toBeTruthy();

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code,
  });

  expect(verify.status).toBe(200);

  return {
    accessToken: verify.body.tokens.accessToken,
    refreshToken: verify.body.tokens.refreshToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
    user: verify.body.user,
  };
};

const createInviteWithToken = async ({
  workspaceId,
  accessToken,
  email,
  roleKey,
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app)
      .post(`/api/workspaces/${workspaceId}/invites`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ email, roleKey })
  );

  return {
    response,
    token: extractInviteTokenFromLogs(logs),
  };
};

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey, email }) => {
  await setWorkspaceBillingPlanForTests({
    workspaceId: owner.workspaceId,
    planKey: 'business',
  });

  const member = await createVerifiedUser({
    email,
  });

  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.user.email,
    roleKey,
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app)
    .post('/api/workspaces/invites/accept')
    .send({
      token: invite.token,
      email: member.user.email,
    });
  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email: member.user.email,
    password: 'Password123!',
  });
  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId: owner.workspaceId });
  expect(switched.status).toBe(200);

  return {
    accessToken: switched.body.accessToken,
    user: member.user,
  };
};

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

describe('Workspace invites lifecycle', () => {
  maybeDbTest('create invite (owner/admin)', async () => {
    const owner = await createVerifiedUser({
      email: 'owner-create-invite@example.com',
      name: 'Owner Invite',
    });

    const createResult = await createInviteWithToken({
      workspaceId: owner.workspaceId,
      accessToken: owner.accessToken,
      email: 'agent-invite@example.com',
      roleKey: WORKSPACE_ROLES.AGENT,
    });

    expect(createResult.response.status).toBe(200);
    expect(createResult.response.body.messageKey).toBe(
      'success.invite.created'
    );
    expect(createResult.response.body.invite.email).toBe(
      'agent-invite@example.com'
    );
    expect(createResult.token).toBeTruthy();
  });

  maybeDbTest(
    'owner and admin invite role restrictions are enforced',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-invite-role-policy@example.com',
        name: 'Owner Role Policy',
      });
      await setWorkspaceBillingPlanForTests({
        workspaceId: owner.workspaceId,
        planKey: 'business',
      });

      for (const roleKey of Object.values(WORKSPACE_ROLES)) {
        const created = await createInviteWithToken({
          workspaceId: owner.workspaceId,
          accessToken: owner.accessToken,
          email: `owner-can-invite-${roleKey}@example.com`,
          roleKey,
        });

        expect(created.response.status).toBe(200);
        expect(created.response.body.invite.roleKey).toBe(roleKey);
      }

      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'admin-invite-role-policy@example.com',
      });

      for (const roleKey of [WORKSPACE_ROLES.AGENT, WORKSPACE_ROLES.VIEWER]) {
        const created = await createInviteWithToken({
          workspaceId: owner.workspaceId,
          accessToken: admin.accessToken,
          email: `admin-can-invite-${roleKey}@example.com`,
          roleKey,
        });

        expect(created.response.status).toBe(200);
        expect(created.response.body.invite.roleKey).toBe(roleKey);
      }

      for (const roleKey of [WORKSPACE_ROLES.OWNER, WORKSPACE_ROLES.ADMIN]) {
        const blocked = await request(app)
          .post(`/api/workspaces/${owner.workspaceId}/invites`)
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({
            email: `admin-blocked-${roleKey}@example.com`,
            roleKey,
          });

        expect(blocked.status).toBe(403);
        expect(blocked.body.messageKey).toBe(
          'errors.workspace.cannotManageRole'
        );
      }
    }
  );

  maybeDbTest(
    'list invites and get invite by id with pagination fields',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-list-invites@example.com',
      });

      const created = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'list-invite@example.com',
        roleKey: WORKSPACE_ROLES.VIEWER,
      });

      const inviteId = created.response.body.invite._id;

      const listResponse = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/invites?page=1&limit=10`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.page).toBe(1);
      expect(listResponse.body.limit).toBe(10);
      expect(listResponse.body.total).toBe(1);
      expect(listResponse.body.results).toBe(1);
      expect(listResponse.body.invites.length).toBe(1);

      const getResponse = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/invites/${inviteId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.invite._id).toBe(inviteId);
    }
  );

  maybeDbTest('revoke invite', async () => {
    const owner = await createVerifiedUser({
      email: 'owner-revoke-invite@example.com',
    });

    const created = await createInviteWithToken({
      workspaceId: owner.workspaceId,
      accessToken: owner.accessToken,
      email: 'revoke-invite@example.com',
      roleKey: WORKSPACE_ROLES.AGENT,
    });

    const inviteId = created.response.body.invite._id;

    const revokeResponse = await request(app)
      .post(`/api/workspaces/${owner.workspaceId}/invites/${inviteId}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.messageKey).toBe('success.invite.revoked');

    const invite = await WorkspaceInvite.findById(inviteId);
    expect(invite.status).toBe(INVITE_STATUS.REVOKED);
  });

  maybeDbTest('resend invite regenerates tokenHash', async () => {
    const owner = await createVerifiedUser({
      email: 'owner-resend-invite@example.com',
    });

    const created = await createInviteWithToken({
      workspaceId: owner.workspaceId,
      accessToken: owner.accessToken,
      email: 'resend-invite@example.com',
      roleKey: WORKSPACE_ROLES.AGENT,
    });

    const inviteId = created.response.body.invite._id;
    const before = await WorkspaceInvite.findById(inviteId);

    const resendResult = await captureFallbackEmail(() =>
      request(app)
        .post(`/api/workspaces/${owner.workspaceId}/invites/${inviteId}/resend`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({})
    );

    expect(resendResult.response.status).toBe(200);
    expect(resendResult.response.body.messageKey).toBe('success.invite.resent');

    const resentToken = extractInviteTokenFromLogs(resendResult.logs);
    expect(resentToken).toBeTruthy();

    const after = await WorkspaceInvite.findById(inviteId);
    expect(after.tokenHash).not.toBe(before.tokenHash);
  });

  maybeDbTest('accept invite for new user requires verification', async () => {
    const owner = await createVerifiedUser({
      email: 'owner-accept-new@example.com',
    });

    const created = await createInviteWithToken({
      workspaceId: owner.workspaceId,
      accessToken: owner.accessToken,
      email: 'new-invite-user@example.com',
      roleKey: WORKSPACE_ROLES.AGENT,
    });

    const acceptResponse = await request(app)
      .post('/api/workspaces/invites/accept')
      .send({
        token: created.token,
        email: 'new-invite-user@example.com',
        password: 'Password123!',
        name: 'New Invite User',
      });

    expect(acceptResponse.status).toBe(200);
    expect(acceptResponse.body.messageKey).toBe(
      'success.invite.acceptRequiresVerification'
    );
    expect(acceptResponse.body.workspaceId).toBe(owner.workspaceId);

    const invite = await WorkspaceInvite.findById(
      created.response.body.invite._id
    );
    expect(invite.status).toBe(INVITE_STATUS.PENDING);

    const user = await User.findOne({
      emailNormalized: 'new-invite-user@example.com',
    });
    expect(user).toBeTruthy();
    expect(user.isEmailVerified).toBe(false);
  });

  maybeDbTest(
    'accept invite for verified user creates member and marks invite accepted',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-accept-verified@example.com',
      });

      const invitee = await createVerifiedUser({
        email: 'verified-invitee@example.com',
      });

      const created = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.ADMIN,
      });

      const acceptResponse = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: created.token,
          email: invitee.user.email,
        });

      expect(acceptResponse.status).toBe(200);
      expect(acceptResponse.body.messageKey).toBe('success.invite.accepted');
      expect(acceptResponse.body.workspaceId).toBe(owner.workspaceId);

      const invite = await WorkspaceInvite.findById(
        created.response.body.invite._id
      );
      expect(invite.status).toBe(INVITE_STATUS.ACCEPTED);

      const inviteeUser = await User.findOne({
        emailNormalized: invitee.user.email.toLowerCase(),
      });
      const member = await WorkspaceMember.findOne({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
        status: MEMBER_STATUS.ACTIVE,
      });

      expect(member).toBeTruthy();
      expect(member.roleKey).toBe(WORKSPACE_ROLES.ADMIN);
    }
  );

  maybeDbTest(
    'removed member can be re-invited and acceptance reuses membership record',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-reinvite-removed@example.com',
      });
      const invitee = await createVerifiedUser({
        email: 'removed-reinvite-user@example.com',
      });

      const initialInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      expect(initialInvite.response.status).toBe(200);

      const initialAccept = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: initialInvite.token,
          email: invitee.user.email,
        });
      expect(initialAccept.status).toBe(200);

      const inviteeUser = await User.findOne({
        emailNormalized: invitee.user.email.toLowerCase(),
      });
      const originalMember = await WorkspaceMember.findOne({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
      });
      expect(originalMember).toBeTruthy();

      const remove = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${inviteeUser._id}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(remove.status).toBe(200);

      const removedMember = await WorkspaceMember.findById(originalMember._id);
      expect(removedMember.status).toBe(MEMBER_STATUS.REMOVED);
      expect(removedMember.removedAt).toBeTruthy();
      expect(removedMember.deletedAt).toBeTruthy();
      expect(removedMember.deletedByUserId).toBeTruthy();

      const reInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      expect(reInvite.response.status).toBe(200);

      const reAccept = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: reInvite.token,
          email: invitee.user.email,
        });
      expect(reAccept.status).toBe(200);
      expect(reAccept.body.roleKey).toBe(WORKSPACE_ROLES.VIEWER);

      const restoredMembers = await WorkspaceMember.find({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
      });
      expect(restoredMembers).toHaveLength(1);
      expect(String(restoredMembers[0]._id)).toBe(String(originalMember._id));
      expect(restoredMembers[0].status).toBe(MEMBER_STATUS.ACTIVE);
      expect(restoredMembers[0].roleKey).toBe(WORKSPACE_ROLES.VIEWER);
      expect(restoredMembers[0].removedAt).toBeNull();
      expect(restoredMembers[0].deletedAt).toBeNull();
      expect(restoredMembers[0].deletedByUserId).toBeNull();
    }
  );

  maybeDbTest(
    'stale removed-member invite acceptance does not overwrite an already-active role',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-stale-reinvite@example.com',
      });
      const invitee = await createVerifiedUser({
        email: 'stale-reinvite-user@example.com',
      });

      const initialInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      expect(initialInvite.response.status).toBe(200);

      const initialAccept = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: initialInvite.token,
          email: invitee.user.email,
        });
      expect(initialAccept.status).toBe(200);

      const inviteeUser = await User.findOne({
        emailNormalized: invitee.user.email.toLowerCase(),
      });
      const originalMember = await WorkspaceMember.findOne({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
      });

      const remove = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${inviteeUser._id}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(remove.status).toBe(200);

      const staleInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      expect(staleInvite.response.status).toBe(200);

      await WorkspaceMember.updateOne(
        { _id: originalMember._id },
        {
          $set: {
            status: MEMBER_STATUS.ACTIVE,
            roleKey: WORKSPACE_ROLES.ADMIN,
            removedAt: null,
            deletedAt: null,
            deletedByUserId: null,
          },
        }
      );

      const staleAccept = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: staleInvite.token,
          email: invitee.user.email,
        });

      expect(staleAccept.status).toBe(409);
      expect(staleAccept.body.messageKey).toBe('errors.invite.alreadyMember');

      const memberships = await WorkspaceMember.find({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
      });
      expect(memberships).toHaveLength(1);
      expect(String(memberships[0]._id)).toBe(String(originalMember._id));
      expect(memberships[0].status).toBe(MEMBER_STATUS.ACTIVE);
      expect(memberships[0].roleKey).toBe(WORKSPACE_ROLES.ADMIN);

      const invite = await WorkspaceInvite.findById(
        staleInvite.response.body.invite._id
      );
      expect(invite.status).toBe(INVITE_STATUS.PENDING);
    }
  );

  maybeDbTest(
    'stale removed-member invite verify-email finalization does not overwrite an already-active role',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-stale-finalize@example.com',
      });
      const invitee = await createVerifiedUser({
        email: 'stale-finalize-user@example.com',
      });

      const initialInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      expect(initialInvite.response.status).toBe(200);

      const initialAccept = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: initialInvite.token,
          email: invitee.user.email,
        });
      expect(initialAccept.status).toBe(200);

      const inviteeUser = await User.findOne({
        emailNormalized: invitee.user.email.toLowerCase(),
      });
      const originalMember = await WorkspaceMember.findOne({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
      });

      const remove = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${inviteeUser._id}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(remove.status).toBe(200);

      const staleInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      expect(staleInvite.response.status).toBe(200);

      await User.updateOne(
        { _id: inviteeUser._id },
        { $set: { isEmailVerified: false } }
      );
      await OtpCode.deleteMany({
        emailNormalized: invitee.user.email.toLowerCase(),
        purpose: OTP_PURPOSE.VERIFY_EMAIL,
      });

      const acceptResult = await captureFallbackEmail(() =>
        request(app).post('/api/workspaces/invites/accept').send({
          token: staleInvite.token,
          email: invitee.user.email,
        })
      );
      expect(acceptResult.response.status).toBe(200);
      expect(acceptResult.response.body.messageKey).toBe(
        'success.invite.acceptRequiresVerification'
      );
      const verifyCode = extractOtpCodeFromLogs(acceptResult.logs);
      expect(verifyCode).toBeTruthy();

      await WorkspaceMember.updateOne(
        { _id: originalMember._id },
        {
          $set: {
            status: MEMBER_STATUS.ACTIVE,
            roleKey: WORKSPACE_ROLES.ADMIN,
            removedAt: null,
            deletedAt: null,
            deletedByUserId: null,
          },
        }
      );

      const verifyResponse = await request(app)
        .post('/api/auth/verify-email')
        .send({
          email: invitee.user.email,
          code: verifyCode,
          inviteToken: staleInvite.token,
        });

      expect(verifyResponse.status).toBe(409);
      expect(verifyResponse.body.messageKey).toBe(
        'errors.invite.alreadyMember'
      );

      const memberships = await WorkspaceMember.find({
        workspaceId: owner.workspaceId,
        userId: inviteeUser._id,
      });
      expect(memberships).toHaveLength(1);
      expect(String(memberships[0]._id)).toBe(String(originalMember._id));
      expect(memberships[0].status).toBe(MEMBER_STATUS.ACTIVE);
      expect(memberships[0].roleKey).toBe(WORKSPACE_ROLES.ADMIN);

      const invite = await WorkspaceInvite.findById(
        staleInvite.response.body.invite._id
      );
      expect(invite.status).toBe(INVITE_STATUS.PENDING);
    }
  );

  maybeDbTest(
    'active and suspended members cannot be invited again',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-reinvite-blocked@example.com',
      });
      await setWorkspaceBillingPlanForTests({
        workspaceId: owner.workspaceId,
        planKey: 'business',
      });
      const activeMember = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'active-reinvite-blocked@example.com',
      });
      const suspendedMember = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'suspended-reinvite-blocked@example.com',
      });

      const suspend = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${suspendedMember.user._id}/suspend`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(suspend.status).toBe(200);

      for (const email of [
        activeMember.user.email,
        suspendedMember.user.email,
      ]) {
        const blocked = await request(app)
          .post(`/api/workspaces/${owner.workspaceId}/invites`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({
            email,
            roleKey: WORKSPACE_ROLES.AGENT,
          });

        expect(blocked.status).toBe(409);
        expect(blocked.body.messageKey).toBe('errors.invite.alreadyMember');
      }
    }
  );

  maybeDbTest(
    'verify-email with inviteToken finalizes invite acceptance for new user',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-finalize-invite@example.com',
      });

      const created = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'finalize-new-user@example.com',
        roleKey: WORKSPACE_ROLES.AGENT,
      });

      const acceptResult = await captureFallbackEmail(() =>
        request(app).post('/api/workspaces/invites/accept').send({
          token: created.token,
          email: 'finalize-new-user@example.com',
          password: 'Password123!',
          name: 'Finalize Invite User',
        })
      );

      expect(acceptResult.response.status).toBe(200);
      expect(acceptResult.response.body.messageKey).toBe(
        'success.invite.acceptRequiresVerification'
      );

      const verifyCode = extractOtpCodeFromLogs(acceptResult.logs);
      expect(verifyCode).toBeTruthy();

      const verifyResponse = await request(app)
        .post('/api/auth/verify-email')
        .send({
          email: 'finalize-new-user@example.com',
          code: verifyCode,
          inviteToken: created.token,
        });

      expect(verifyResponse.status).toBe(200);
      expect(verifyResponse.body.messageKey).toBe('success.auth.verified');
      expect(verifyResponse.body.tokens.accessToken).toBeTruthy();
      expect(verifyResponse.body.workspaceId).toBe(owner.workspaceId);
      expect(verifyResponse.body.inviteWorkspaceId).toBe(owner.workspaceId);
      expect(verifyResponse.body.activeWorkspaceId).toBeTruthy();
      const verifyTokenPayload = jwt.decode(
        verifyResponse.body.tokens.accessToken
      );
      expect(verifyTokenPayload.wid).toBe(
        verifyResponse.body.activeWorkspaceId
      );

      const invite = await WorkspaceInvite.findById(
        created.response.body.invite._id
      );
      expect(invite.status).toBe(INVITE_STATUS.ACCEPTED);

      const user = await User.findOne({
        emailNormalized: 'finalize-new-user@example.com',
      });
      const member = await WorkspaceMember.findOne({
        workspaceId: owner.workspaceId,
        userId: user._id,
        status: MEMBER_STATUS.ACTIVE,
      });

      expect(member).toBeTruthy();

      const meResponse = await request(app)
        .get('/api/auth/me')
        .set(
          'Authorization',
          `Bearer ${verifyResponse.body.tokens.accessToken}`
        );

      expect(meResponse.status).toBe(200);
      expect(meResponse.body.workspace._id).toBe(owner.workspaceId);
    }
  );

  maybeDbTest(
    'create invite is blocked when seat capacity is full and pending invites consume reserved seats',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-seat-limit-create@example.com',
      });

      await patchPlanForTests({
        planKey: 'starter',
        limits: {
          seatsIncluded: 3,
        },
      });

      const firstInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'seat-limit-a@example.com',
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const secondInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'seat-limit-b@example.com',
        roleKey: WORKSPACE_ROLES.AGENT,
      });

      expect(firstInvite.response.status).toBe(200);
      expect(secondInvite.response.status).toBe(200);

      const blocked = await request(app)
        .post(`/api/workspaces/${owner.workspaceId}/invites`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          email: 'seat-limit-c@example.com',
          roleKey: WORKSPACE_ROLES.AGENT,
        });

      expect(blocked.status).toBe(409);
      expect(blocked.body.messageKey).toBe('errors.billing.seatLimitExceeded');
    }
  );

  maybeDbTest(
    'accept invite for verified user is blocked when seat capacity is unavailable at activation time',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-seat-limit-accept@example.com',
      });
      const invitee = await createVerifiedUser({
        email: 'seat-limit-accept-user@example.com',
      });

      const created = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: invitee.user.email,
        roleKey: WORKSPACE_ROLES.ADMIN,
      });

      await patchPlanForTests({
        planKey: 'starter',
        limits: {
          seatsIncluded: 1,
        },
      });

      const acceptResponse = await request(app)
        .post('/api/workspaces/invites/accept')
        .send({
          token: created.token,
          email: invitee.user.email,
        });

      expect(acceptResponse.status).toBe(409);
      expect(acceptResponse.body.messageKey).toBe(
        'errors.billing.seatLimitExceeded'
      );

      const invite = await WorkspaceInvite.findById(
        created.response.body.invite._id
      );
      expect(invite.status).toBe(INVITE_STATUS.PENDING);
    }
  );

  maybeDbTest(
    'verify-email invite finalization is blocked when seat capacity is unavailable at activation time',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-seat-limit-finalize@example.com',
      });

      const created = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'seat-limit-finalize-user@example.com',
        roleKey: WORKSPACE_ROLES.AGENT,
      });

      const acceptResult = await captureFallbackEmail(() =>
        request(app).post('/api/workspaces/invites/accept').send({
          token: created.token,
          email: 'seat-limit-finalize-user@example.com',
          password: 'Password123!',
          name: 'Seat Finalize User',
        })
      );

      expect(acceptResult.response.status).toBe(200);
      expect(acceptResult.response.body.messageKey).toBe(
        'success.invite.acceptRequiresVerification'
      );

      const verifyCode = extractOtpCodeFromLogs(acceptResult.logs);
      expect(verifyCode).toBeTruthy();

      await patchPlanForTests({
        planKey: 'starter',
        limits: {
          seatsIncluded: 1,
        },
      });

      const verifyResponse = await request(app)
        .post('/api/auth/verify-email')
        .send({
          email: 'seat-limit-finalize-user@example.com',
          code: verifyCode,
          inviteToken: created.token,
        });

      expect(verifyResponse.status).toBe(409);
      expect(verifyResponse.body.messageKey).toBe(
        'errors.billing.seatLimitExceeded'
      );

      const invite = await WorkspaceInvite.findById(
        created.response.body.invite._id
      );
      expect(invite.status).toBe(INVITE_STATUS.PENDING);
    }
  );

  maybeDbTest(
    'suspended and removed members do not consume seats while pending invites still do',
    async () => {
      const owner = await createVerifiedUser({
        email: 'owner-seat-suspended-removed@example.com',
      });
      const firstMember = await createVerifiedUser({
        email: 'seat-suspended-member@example.com',
      });
      const secondMember = await createVerifiedUser({
        email: 'seat-removed-member@example.com',
      });

      const firstInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: firstMember.user.email,
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const secondInvite = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: secondMember.user.email,
        roleKey: WORKSPACE_ROLES.AGENT,
      });

      expect(
        (
          await request(app).post('/api/workspaces/invites/accept').send({
            token: firstInvite.token,
            email: firstMember.user.email,
          })
        ).status
      ).toBe(200);
      expect(
        (
          await request(app).post('/api/workspaces/invites/accept').send({
            token: secondInvite.token,
            email: secondMember.user.email,
          })
        ).status
      ).toBe(200);

      const [firstMembership, secondMembership] = await Promise.all([
        WorkspaceMember.findOne({
          workspaceId: owner.workspaceId,
          userId: firstMember.user._id,
        }),
        WorkspaceMember.findOne({
          workspaceId: owner.workspaceId,
          userId: secondMember.user._id,
        }),
      ]);

      firstMembership.status = MEMBER_STATUS.SUSPENDED;
      await firstMembership.save();

      secondMembership.status = MEMBER_STATUS.REMOVED;
      secondMembership.removedAt = new Date();
      await secondMembership.save();

      await setWorkspaceBillingPlanForTests({
        workspaceId: owner.workspaceId,
        planKey: 'starter',
      });
      await patchPlanForTests({
        planKey: 'starter',
        limits: {
          seatsIncluded: 3,
        },
      });

      const reserveA = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'seat-open-a@example.com',
        roleKey: WORKSPACE_ROLES.AGENT,
      });
      const reserveB = await createInviteWithToken({
        workspaceId: owner.workspaceId,
        accessToken: owner.accessToken,
        email: 'seat-open-b@example.com',
        roleKey: WORKSPACE_ROLES.AGENT,
      });

      expect(reserveA.response.status).toBe(200);
      expect(reserveB.response.status).toBe(200);
    }
  );
});
