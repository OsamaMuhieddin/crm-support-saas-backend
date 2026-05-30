import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { MEMBER_STATUS } from '../src/constants/member-status.js';
import { User } from '../src/modules/users/models/user.model.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { normalizeEmail } from '../src/shared/utils/normalize.js';
import { createSessionWithTokens } from '../src/modules/auth/services/session.service.js';
import { ensureWorkspaceForVerifiedUser } from '../src/modules/workspaces/services/workspaces.service.js';
import {
  patchPlanForTests,
  setWorkspaceBillingPlanForTests,
} from './helpers/billing.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const createVerifiedUser = async ({ email, name = 'Test User' }) => {
  const user = await User.create({
    email,
    emailNormalized: normalizeEmail(email),
    isEmailVerified: true,
    profile: { name },
  });

  const workspaceContext = await ensureWorkspaceForVerifiedUser({
    userId: user._id,
  });

  const { tokens } = await createSessionWithTokens({
    userId: user._id,
    workspaceId: workspaceContext.activeWorkspaceId,
    roleKey: workspaceContext.activeRoleKey,
  });

  return {
    email,
    userId: String(user._id),
    accessToken: tokens.accessToken,
    workspaceId: workspaceContext.activeWorkspaceId,
  };
};

const createWorkspaceMember = async ({ owner, roleKey, email, name }) => {
  const user = await User.create({
    email,
    emailNormalized: normalizeEmail(email),
    isEmailVerified: true,
    profile: { name },
  });

  await WorkspaceMember.create({
    workspaceId: owner.workspaceId,
    userId: user._id,
    roleKey,
    status: MEMBER_STATUS.ACTIVE,
    joinedAt: new Date(),
  });

  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        defaultWorkspaceId: owner.workspaceId,
        lastWorkspaceId: owner.workspaceId,
      },
    }
  );

  const { tokens } = await createSessionWithTokens({
    userId: user._id,
    workspaceId: owner.workspaceId,
    roleKey,
  });

  return {
    email,
    userId: String(user._id),
    accessToken: tokens.accessToken,
  };
};

const expectTokenRevoked = async (accessToken) => {
  const response = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${accessToken}`);

  expect(response.status).toBe(401);
  expect(response.body.messageKey).toBe('errors.auth.sessionRevoked');
};

const createAssignedTicket = async ({ workspaceId, assigneeId }) => {
  return Ticket.create({
    workspaceId,
    mailboxId: new mongoose.Types.ObjectId(),
    number: 1,
    subject: 'Historical assignment',
    contactId: new mongoose.Types.ObjectId(),
    assigneeId,
  });
};

describe('Workspace member read/search endpoints', () => {
  maybeDbTest('requires auth and active workspace tenant match', async () => {
    const ownerA = await createVerifiedUser({
      email: 'members-auth-owner-a@example.com',
    });
    const ownerB = await createVerifiedUser({
      email: 'members-auth-owner-b@example.com',
    });

    const noAuth = await request(app).get(
      `/api/workspaces/${ownerA.workspaceId}/members`
    );
    expect(noAuth.status).toBe(401);

    const tenantMismatch = await request(app)
      .get(`/api/workspaces/${ownerB.workspaceId}/members`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(tenantMismatch.status).toBe(403);
    expect(tenantMismatch.body.messageKey).toBe('errors.auth.forbiddenTenant');

    await WorkspaceMember.updateOne(
      { workspaceId: ownerA.workspaceId, userId: ownerA.userId },
      { $set: { status: MEMBER_STATUS.SUSPENDED } }
    );

    const inactiveMember = await request(app)
      .get(`/api/workspaces/${ownerA.workspaceId}/members`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(inactiveMember.status).toBe(403);
    expect(inactiveMember.body.messageKey).toBe('errors.auth.forbiddenTenant');
  });

  maybeDbTest(
    'owner list supports search aliases, pagination, filters, sort validation, options, and detail',
    async () => {
      const owner = await createVerifiedUser({
        email: 'members-owner@example.com',
        name: 'Owner Person',
      });
      const admin = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'members-admin@example.com',
        name: 'Admin Person',
      });
      const agent = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-agent@example.com',
        name: 'Alpha Agent',
      });
      const viewer = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-viewer@example.com',
        name: 'Viewer Person',
      });
      const suspended = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-suspended@example.com',
        name: 'Suspended Agent',
      });
      const removed = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-removed@example.com',
        name: 'Removed Viewer',
      });

      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: suspended.userId },
        { $set: { status: MEMBER_STATUS.SUSPENDED } }
      );
      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: removed.userId },
        {
          $set: {
            status: MEMBER_STATUS.REMOVED,
            removedAt: new Date('2026-05-27T00:00:00.000Z'),
          },
        }
      );

      const invalidSort = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?sort=bad`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(invalidSort.status).toBe(422);
      expect(invalidSort.body.messageKey).toBe('errors.validation.failed');

      const searchByQ = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?q=Alpha`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(searchByQ.status).toBe(200);
      expect(searchByQ.body.members).toHaveLength(1);
      expect(searchByQ.body.members[0].userId).toBe(agent.userId);

      const searchByAlias = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?search=members-agent`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(searchByAlias.status).toBe(200);
      expect(searchByAlias.body.members[0].user.email).toBe(agent.email);

      const paged = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?page=1&limit=2&sort=name`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(paged.status).toBe(200);
      expect(paged.body.limit).toBe(2);
      expect(paged.body.results).toBe(2);
      expect(paged.body.total).toBe(4);

      const roleFiltered = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?roleKey=viewer`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(roleFiltered.status).toBe(200);
      expect(roleFiltered.body.members.map((member) => member.userId)).toEqual([
        viewer.userId,
      ]);

      const suspendedList = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?status=suspended`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(suspendedList.status).toBe(200);
      expect(suspendedList.body.members[0].userId).toBe(suspended.userId);

      const includeRemoved = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?includeRemoved=true`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(includeRemoved.status).toBe(200);
      expect(
        includeRemoved.body.members.some(
          (member) => member.userId === removed.userId
        )
      ).toBe(true);

      const assignable = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?assignable=true`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(assignable.status).toBe(200);
      expect(assignable.body.members.map((member) => member.userId)).toEqual(
        expect.arrayContaining([owner.userId, admin.userId, agent.userId])
      );
      expect(
        assignable.body.members.some(
          (member) => member.userId === viewer.userId
        )
      ).toBe(false);
      expect(
        assignable.body.members.some(
          (member) => member.userId === suspended.userId
        )
      ).toBe(false);

      const participantEligible = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?participantEligible=true`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(participantEligible.status).toBe(200);
      expect(
        participantEligible.body.members.some(
          (member) => member.userId === viewer.userId
        )
      ).toBe(true);
      expect(
        participantEligible.body.members.some(
          (member) => member.userId === suspended.userId
        )
      ).toBe(false);

      const options = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members/options?assignable=true`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(options.status).toBe(200);
      expect(options.body.results).toBe(options.body.members.length);
      expect(options.body.members[0]._id).toBeUndefined();
      expect(options.body.members[0].userId).toBeTruthy();
      expect(options.body.members.every((member) => member.email)).toBe(true);

      const detail = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members/${removed.userId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.member.userId).toBe(removed.userId);
      expect(detail.body.member.removedAt).toBeTruthy();
    }
  );

  maybeDbTest(
    'agent and viewer visibility is active-only, and viewer email is omitted from list/options/detail',
    async () => {
      const owner = await createVerifiedUser({
        email: 'members-visibility-owner@example.com',
      });
      const agent = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-visibility-agent@example.com',
        name: 'Visible Agent',
      });
      const viewer = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-visibility-viewer@example.com',
        name: 'Visible Viewer',
      });
      const suspended = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-visibility-suspended@example.com',
        name: 'Hidden Suspended',
      });
      const removed = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-visibility-removed@example.com',
        name: 'Hidden Removed',
      });
      const sortSecondByEmail = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'sort-b@example.com',
        name: 'Sort Twin',
      });
      const sortFirstByEmail = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'sort-a@example.com',
        name: 'Sort Twin',
      });
      const sortLastByEmail = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'sort-z@example.com',
        name: 'Sort Twin',
      });

      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: suspended.userId },
        { $set: { status: MEMBER_STATUS.SUSPENDED } }
      );
      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: removed.userId },
        { $set: { status: MEMBER_STATUS.REMOVED, removedAt: new Date() } }
      );

      const agentList = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?includeRemoved=true&status=suspended`
        )
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentList.status).toBe(200);
      expect(
        agentList.body.members.map((member) => member.memberStatus)
      ).toEqual(expect.arrayContaining([MEMBER_STATUS.ACTIVE]));
      expect(
        agentList.body.members.some(
          (member) => member.userId === suspended.userId
        )
      ).toBe(false);
      expect(agentList.body.members.every((member) => member.user.email)).toBe(
        true
      );

      const viewerList = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerList.status).toBe(200);
      expect(viewerList.body.members.some((member) => member.user.email)).toBe(
        false
      );
      expect(
        viewerList.body.members.every(
          (member) => member.memberStatus === MEMBER_STATUS.ACTIVE
        )
      ).toBe(true);

      const viewerEmailSearch = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?search=members-visibility-agent@example.com`
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerEmailSearch.status).toBe(200);
      expect(viewerEmailSearch.body.members).toHaveLength(0);

      const viewerDefaultSort = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?q=Sort%20Twin&roleKey=agent`
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      const viewerEmailSort = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?q=Sort%20Twin&roleKey=agent&sort=email`
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      const viewerEmailDescSort = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?q=Sort%20Twin&roleKey=agent&sort=-email`
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(viewerDefaultSort.status).toBe(200);
      expect(viewerEmailSort.status).toBe(200);
      expect(viewerEmailDescSort.status).toBe(200);
      expect(
        viewerEmailSort.body.members.map((member) => member.userId)
      ).toEqual(viewerDefaultSort.body.members.map((member) => member.userId));
      expect(
        viewerEmailDescSort.body.members.map((member) => member.userId)
      ).toEqual(viewerDefaultSort.body.members.map((member) => member.userId));
      expect(
        viewerEmailSort.body.members.some((member) => member.user.email)
      ).toBe(false);

      const viewerEmailSortOptions = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members/options?q=Sort%20Twin&roleKey=agent&sort=email`
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerEmailSortOptions.status).toBe(200);
      expect(
        viewerEmailSortOptions.body.members.map((member) => member.userId)
      ).toEqual(viewerDefaultSort.body.members.map((member) => member.userId));
      expect(
        viewerEmailSortOptions.body.members.some((member) => member.email)
      ).toBe(false);

      const agentEmailSort = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?q=Sort%20Twin&roleKey=agent&sort=email`
        )
        .set('Authorization', `Bearer ${agent.accessToken}`);
      const ownerEmailDescSort = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?q=Sort%20Twin&roleKey=agent&sort=-email`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(agentEmailSort.status).toBe(200);
      expect(
        agentEmailSort.body.members.map((member) => member.userId)
      ).toEqual([
        sortFirstByEmail.userId,
        sortSecondByEmail.userId,
        sortLastByEmail.userId,
      ]);
      expect(
        agentEmailSort.body.members.every((member) => member.user.email)
      ).toBe(true);
      expect(ownerEmailDescSort.status).toBe(200);
      expect(
        ownerEmailDescSort.body.members.map((member) => member.userId)
      ).toEqual([
        sortLastByEmail.userId,
        sortSecondByEmail.userId,
        sortFirstByEmail.userId,
      ]);

      const viewerOptions = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members/options`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerOptions.status).toBe(200);
      expect(viewerOptions.body.members.some((member) => member.email)).toBe(
        false
      );

      const agentSuspendedDetail = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members/${suspended.userId}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentSuspendedDetail.status).toBe(404);
      expect(agentSuspendedDetail.body.messageKey).toBe(
        'errors.workspace.memberNotFound'
      );

      const viewerOwnDetail = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerOwnDetail.status).toBe(200);
      expect(viewerOwnDetail.body.member.user.email).toBeUndefined();
    }
  );
});

describe('Workspace member management action endpoints', () => {
  maybeDbTest(
    'PATCH role enforces auth, tenant, authority, self, last-owner, and session invalidation',
    async () => {
      const owner = await createVerifiedUser({
        email: 'members-actions-owner@example.com',
      });
      const otherWorkspace = await createVerifiedUser({
        email: 'members-actions-other-workspace@example.com',
      });
      const admin = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'members-actions-admin@example.com',
        name: 'Actions Admin',
      });
      const agent = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-actions-agent@example.com',
        name: 'Actions Agent',
      });
      const viewer = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-actions-viewer@example.com',
        name: 'Actions Viewer',
      });
      const secondOwner = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.OWNER,
        email: 'members-actions-owner-two@example.com',
        name: 'Second Owner',
      });

      const noAuth = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${agent.userId}`)
        .send({ roleKey: WORKSPACE_ROLES.VIEWER });
      expect(noAuth.status).toBe(401);

      const tenantMismatch = await request(app)
        .patch(
          `/api/workspaces/${otherWorkspace.workspaceId}/members/${agent.userId}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ roleKey: WORKSPACE_ROLES.VIEWER });
      expect(tenantMismatch.status).toBe(403);

      const ownerChangesAdmin = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${admin.userId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ roleKey: WORKSPACE_ROLES.AGENT });
      expect(ownerChangesAdmin.status).toBe(200);
      expect(ownerChangesAdmin.body.messageKey).toBe(
        'success.workspace.memberUpdated'
      );
      expect(ownerChangesAdmin.body.member).toMatchObject({
        userId: admin.userId,
        roleKey: WORKSPACE_ROLES.AGENT,
        memberStatus: MEMBER_STATUS.ACTIVE,
      });
      await expectTokenRevoked(admin.accessToken);

      const ownerDemotesOtherOwner = await request(app)
        .patch(
          `/api/workspaces/${owner.workspaceId}/members/${secondOwner.userId}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ roleKey: WORKSPACE_ROLES.ADMIN });
      expect(ownerDemotesOtherOwner.status).toBe(200);

      const lastOwnerBlocked = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${owner.userId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ roleKey: WORKSPACE_ROLES.AGENT });
      expect(lastOwnerBlocked.status).toBe(403);
      expect(lastOwnerBlocked.body.messageKey).toBe(
        'errors.workspace.cannotManageSelf'
      );

      const adminTokenAfterRoleChange = (
        await createSessionWithTokens({
          userId: admin.userId,
          workspaceId: owner.workspaceId,
          roleKey: WORKSPACE_ROLES.AGENT,
        })
      ).tokens.accessToken;
      const adminCannotPromote = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
        .set('Authorization', `Bearer ${adminTokenAfterRoleChange}`)
        .send({ roleKey: WORKSPACE_ROLES.ADMIN });
      expect(adminCannotPromote.status).toBe(403);
      expect(adminCannotPromote.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: admin.userId },
        { $set: { roleKey: WORKSPACE_ROLES.ADMIN } }
      );
      const restoredAdminToken = (
        await createSessionWithTokens({
          userId: admin.userId,
          workspaceId: owner.workspaceId,
          roleKey: WORKSPACE_ROLES.ADMIN,
        })
      ).tokens.accessToken;

      const restoredAdminCannotPromote = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
        .set('Authorization', `Bearer ${restoredAdminToken}`)
        .send({ roleKey: WORKSPACE_ROLES.ADMIN });
      expect(restoredAdminCannotPromote.status).toBe(403);
      expect(restoredAdminCannotPromote.body.messageKey).toBe(
        'errors.workspace.cannotManageRole'
      );

      const adminChangesViewer = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${viewer.userId}`)
        .set('Authorization', `Bearer ${restoredAdminToken}`)
        .send({ roleKey: WORKSPACE_ROLES.AGENT });
      expect(adminChangesViewer.status).toBe(200);

      const adminCannotChangeOwner = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${owner.userId}`)
        .set('Authorization', `Bearer ${restoredAdminToken}`)
        .send({ roleKey: WORKSPACE_ROLES.AGENT });
      expect(adminCannotChangeOwner.status).toBe(403);
      expect(adminCannotChangeOwner.body.messageKey).toBe(
        'errors.workspace.cannotManageRole'
      );

      const unknownField = await request(app)
        .patch(`/api/workspaces/${owner.workspaceId}/members/${agent.userId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ roleKey: WORKSPACE_ROLES.AGENT, extra: true });
      expect(unknownField.status).toBe(422);
      expect(unknownField.body.messageKey).toBe('errors.validation.failed');
    }
  );

  maybeDbTest(
    'suspend enforces role rules, last-owner safety, eligibility removal, ticket preservation, and session invalidation',
    async () => {
      const owner = await createVerifiedUser({
        email: 'members-suspend-owner@example.com',
      });
      const admin = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'members-suspend-admin@example.com',
        name: 'Suspend Admin',
      });
      const agent = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-suspend-agent@example.com',
        name: 'Suspend Agent',
      });
      const viewer = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-suspend-viewer@example.com',
        name: 'Suspend Viewer',
      });
      const otherOwner = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.OWNER,
        email: 'members-suspend-owner-two@example.com',
        name: 'Suspend Owner Two',
      });
      const ticket = await createAssignedTicket({
        workspaceId: owner.workspaceId,
        assigneeId: agent.userId,
      });

      const viewerCannotSuspend = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${agent.userId}/suspend`
        )
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerCannotSuspend.status).toBe(403);
      expect(viewerCannotSuspend.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const adminSuspendsViewer = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${viewer.userId}/suspend`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminSuspendsViewer.status).toBe(200);

      const adminCannotSuspendAdmin = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${admin.userId}/suspend`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminCannotSuspendAdmin.status).toBe(403);
      expect(adminCannotSuspendAdmin.body.messageKey).toBe(
        'errors.workspace.cannotManageSelf'
      );

      const adminCannotSuspendOwner = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${owner.userId}/suspend`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminCannotSuspendOwner.status).toBe(403);
      expect(adminCannotSuspendOwner.body.messageKey).toBe(
        'errors.workspace.cannotManageRole'
      );

      const ownerSuspendsAdmin = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${admin.userId}/suspend`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerSuspendsAdmin.status).toBe(200);

      const ownerSuspendsOtherOwner = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${otherOwner.userId}/suspend`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerSuspendsOtherOwner.status).toBe(200);

      const selfSuspend = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${owner.userId}/suspend`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(selfSuspend.status).toBe(403);
      expect(selfSuspend.body.messageKey).toBe(
        'errors.workspace.cannotManageSelf'
      );

      const suspendAgent = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${agent.userId}/suspend`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(suspendAgent.status).toBe(200);
      expect(suspendAgent.body.member.memberStatus).toBe(
        MEMBER_STATUS.SUSPENDED
      );
      await expectTokenRevoked(agent.accessToken);

      const assignable = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?assignable=true`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        assignable.body.members.some((member) => member.userId === agent.userId)
      ).toBe(false);

      const participantEligible = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?participantEligible=true`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        participantEligible.body.members.some(
          (member) => member.userId === agent.userId
        )
      ).toBe(false);

      const refreshedTicket = await Ticket.findById(ticket._id).lean();
      expect(String(refreshedTicket.assigneeId)).toBe(agent.userId);
    }
  );

  maybeDbTest(
    'activate enforces removed-member block, admin limits, billing seats, eligibility restoration, and session invalidation',
    async () => {
      const owner = await createVerifiedUser({
        email: 'members-activate-owner@example.com',
      });
      const agent = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-activate-agent@example.com',
        name: 'Activate Agent',
      });
      const viewer = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-activate-viewer@example.com',
        name: 'Activate Viewer',
      });
      const admin = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'members-activate-admin@example.com',
        name: 'Activate Admin',
      });
      const removed = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-activate-removed@example.com',
        name: 'Activate Removed',
      });

      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: agent.userId },
        { $set: { status: MEMBER_STATUS.SUSPENDED } }
      );
      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: viewer.userId },
        { $set: { status: MEMBER_STATUS.SUSPENDED } }
      );
      await WorkspaceMember.updateOne(
        { workspaceId: owner.workspaceId, userId: removed.userId },
        {
          $set: {
            status: MEMBER_STATUS.REMOVED,
            removedAt: new Date(),
            deletedAt: new Date(),
          },
        }
      );

      const suspendedAgentToken = (
        await createSessionWithTokens({
          userId: agent.userId,
          workspaceId: owner.workspaceId,
          roleKey: WORKSPACE_ROLES.AGENT,
        })
      ).tokens.accessToken;

      const adminActivatesViewer = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${viewer.userId}/activate`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminActivatesViewer.status).toBe(200);

      const adminCannotActivateAdmin = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${admin.userId}/activate`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminCannotActivateAdmin.status).toBe(403);

      const adminCannotActivateOwner = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${owner.userId}/activate`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminCannotActivateOwner.status).toBe(403);
      expect(adminCannotActivateOwner.body.messageKey).toBe(
        'errors.workspace.cannotManageRole'
      );

      const blockedRemoved = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${removed.userId}/activate`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(blockedRemoved.status).toBe(409);
      expect(blockedRemoved.body.messageKey).toBe(
        'errors.workspace.memberRemoved'
      );

      await patchPlanForTests({
        planKey: 'starter',
        limits: { seatsIncluded: 1 },
      });
      await setWorkspaceBillingPlanForTests({
        workspaceId: owner.workspaceId,
        planKey: 'starter',
      });

      const blockedBySeats = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${agent.userId}/activate`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(blockedBySeats.status).toBe(409);
      expect(blockedBySeats.body.messageKey).toBe(
        'errors.billing.seatLimitExceeded'
      );

      await patchPlanForTests({
        planKey: 'starter',
        limits: { seatsIncluded: 10 },
      });

      const activated = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${agent.userId}/activate`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(activated.status).toBe(200);
      expect(activated.body.member.memberStatus).toBe(MEMBER_STATUS.ACTIVE);
      await expectTokenRevoked(suspendedAgentToken);

      const eligible = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?participantEligible=true`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        eligible.body.members.some((member) => member.userId === agent.userId)
      ).toBe(true);
    }
  );

  maybeDbTest(
    'remove enforces authority and last-owner rules, preserves attribution, hides from active views, and invalidates sessions',
    async () => {
      const owner = await createVerifiedUser({
        email: 'members-remove-owner@example.com',
      });
      const admin = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'members-remove-admin@example.com',
        name: 'Remove Admin',
      });
      const agent = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'members-remove-agent@example.com',
        name: 'Remove Agent',
      });
      const viewer = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'members-remove-viewer@example.com',
        name: 'Remove Viewer',
      });
      const otherOwner = await createWorkspaceMember({
        owner,
        roleKey: WORKSPACE_ROLES.OWNER,
        email: 'members-remove-owner-two@example.com',
        name: 'Remove Owner Two',
      });
      const ticket = await createAssignedTicket({
        workspaceId: owner.workspaceId,
        assigneeId: agent.userId,
      });

      const adminRemovesViewer = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${viewer.userId}/remove`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminRemovesViewer.status).toBe(200);

      const adminCannotRemoveAdmin = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${admin.userId}/remove`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminCannotRemoveAdmin.status).toBe(403);

      const adminCannotRemoveOwner = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${owner.userId}/remove`
        )
        .set('Authorization', `Bearer ${admin.accessToken}`);
      expect(adminCannotRemoveOwner.status).toBe(403);
      expect(adminCannotRemoveOwner.body.messageKey).toBe(
        'errors.workspace.cannotManageRole'
      );

      const ownerRemovesAdmin = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${admin.userId}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerRemovesAdmin.status).toBe(200);

      const ownerRemovesOtherOwner = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${otherOwner.userId}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerRemovesOtherOwner.status).toBe(200);

      const selfRemove = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${owner.userId}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(selfRemove.status).toBe(403);

      const removeAgent = await request(app)
        .post(
          `/api/workspaces/${owner.workspaceId}/members/${agent.userId}/remove`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(removeAgent.status).toBe(200);
      expect(removeAgent.body.member).toMatchObject({
        userId: agent.userId,
        roleKey: WORKSPACE_ROLES.AGENT,
        memberStatus: MEMBER_STATUS.REMOVED,
      });
      expect(removeAgent.body.member.removedAt).toBeTruthy();
      await expectTokenRevoked(agent.accessToken);

      const activeList = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        activeList.body.members.some((member) => member.userId === agent.userId)
      ).toBe(false);

      const removedList = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?status=removed`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        removedList.body.members.some(
          (member) => member.userId === agent.userId
        )
      ).toBe(true);

      const assignable = await request(app)
        .get(`/api/workspaces/${owner.workspaceId}/members?assignable=true`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        assignable.body.members.some((member) => member.userId === agent.userId)
      ).toBe(false);

      const participantEligible = await request(app)
        .get(
          `/api/workspaces/${owner.workspaceId}/members?participantEligible=true`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(
        participantEligible.body.members.some(
          (member) => member.userId === agent.userId
        )
      ).toBe(false);

      const userStillExists = await User.findById(agent.userId).lean();
      expect(userStillExists).toBeTruthy();
      const refreshedTicket = await Ticket.findById(ticket._id).lean();
      expect(String(refreshedTicket.assigneeId)).toBe(agent.userId);
    }
  );
});
