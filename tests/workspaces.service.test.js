import { jest } from '@jest/globals';
import {
  createWorkspaceInvite,
  ensureWorkspaceForVerifiedUser,
} from '../src/modules/workspaces/services/workspaces.service.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import { WorkspaceInvite } from '../src/modules/workspaces/models/workspace-invite.model.js';
import { authConfig } from '../src/config/auth.config.js';

const createQuery = (value) => {
  const query = {
    select: jest.fn(),
    lean: jest.fn()
  };

  query.select.mockReturnValue(query);
  query.lean.mockResolvedValue(value);
  return query;
};

describe('workspaces.service createWorkspaceInvite', () => {
  const originalFrontendBaseUrl = authConfig.frontendBaseUrl;
  const originalAppBaseUrl = authConfig.appBaseUrl;

  beforeEach(() => {
    jest.restoreAllMocks();
    authConfig.frontendBaseUrl = 'http://frontend.local';
    authConfig.appBaseUrl = 'http://backend.local';
  });

  afterAll(() => {
    authConfig.frontendBaseUrl = originalFrontendBaseUrl;
    authConfig.appBaseUrl = originalAppBaseUrl;
  });

  test('invite email link uses FRONTEND_BASE_URL', async () => {
    jest.spyOn(Workspace, 'findOne').mockReturnValue(
      createQuery({ name: 'Acme Workspace' })
    );
    jest.spyOn(User, 'findOne').mockReturnValue(createQuery(null));

    jest.spyOn(WorkspaceInvite, 'create').mockImplementation(async (doc) => ({
      _id: 'invite-1',
      workspaceId: doc.workspaceId,
      email: doc.email,
      roleKey: doc.roleKey,
      status: doc.status,
      expiresAt: doc.expiresAt,
      acceptedAt: null,
      invitedByUserId: doc.invitedByUserId,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    }));

    const logs = [];
    const logSpy = jest.spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args);
    });

    await createWorkspaceInvite({
      workspaceId: 'workspace-1',
      email: 'invitee@example.com',
      roleKey: 'agent',
      invitedByUserId: 'owner-1',
      invitedByName: 'Owner'
    });

    logSpy.mockRestore();

    const emailLog = logs.find(
      (entry) => entry?.[0] === '[email:fallback]' && entry?.[1]?.inviteLinkOrToken
    );

    expect(emailLog).toBeTruthy();
    const emailPayload = emailLog[1];

    expect(emailPayload.inviteLinkOrToken).toMatch(
      /^http:\/\/frontend\.local\/workspaces\/invites\/accept\?token=/
    );
    expect(emailPayload.inviteLinkOrToken).not.toContain('backend.local');
  });

  test('fails with alreadyMember when email belongs to existing non-removed member', async () => {
    jest.spyOn(Workspace, 'findOne').mockReturnValue(
      createQuery({ name: 'Acme Workspace' })
    );
    jest.spyOn(User, 'findOne').mockReturnValue(createQuery({ _id: 'user-1' }));
    jest.spyOn(WorkspaceMember, 'findOne').mockReturnValue(
      createQuery({ _id: 'member-1' })
    );

    const createInviteSpy = jest.spyOn(WorkspaceInvite, 'create');
    await expect(
      createWorkspaceInvite({
        workspaceId: 'workspace-1',
        email: 'member@example.com',
        roleKey: 'agent',
        invitedByUserId: 'owner-1'
      })
    ).rejects.toMatchObject({
      messageKey: 'errors.invite.alreadyMember',
      statusCode: 409
    });

    expect(createInviteSpy).not.toHaveBeenCalled();
  });
});

describe('workspaces.service ensureWorkspaceForVerifiedUser', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('does not persist user workspace linkage before default mailbox provisioning succeeds', async () => {
    const userDoc = {
      _id: 'user-1',
      email: 'owner@example.com',
      defaultWorkspaceId: null,
      lastWorkspaceId: null,
      save: jest.fn().mockResolvedValue(undefined),
    };

    jest.spyOn(User, 'findOne').mockResolvedValue(userDoc);
    jest.spyOn(Workspace, 'exists').mockResolvedValue(false);
    jest.spyOn(Workspace, 'create').mockResolvedValue({
      _id: 'workspace-1',
    });
    jest.spyOn(WorkspaceMember, 'create').mockResolvedValue({
      _id: 'member-1',
    });
    jest.spyOn(Workspace, 'findOne').mockReturnValue(
      createQuery(null)
    );

    await expect(
      ensureWorkspaceForVerifiedUser({
        userId: 'user-1',
      })
    ).rejects.toMatchObject({
      messageKey: 'errors.workspace.notFound',
      statusCode: 404,
    });

    expect(userDoc.save).not.toHaveBeenCalled();
    expect(userDoc.defaultWorkspaceId).toBeNull();
    expect(userDoc.lastWorkspaceId).toBeNull();
  });
});
