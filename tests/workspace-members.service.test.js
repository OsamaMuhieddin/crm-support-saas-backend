import { jest } from '@jest/globals';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  assertLastOwnerSafety,
  assertWorkspaceMemberAuthority,
  buildWorkspaceMemberSort,
  buildWorkspaceMemberActionView,
  buildWorkspaceMemberSummary,
} from '../src/modules/workspaces/services/workspace-members.service.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';

describe('workspace-members.service response shaping', () => {
  const member = {
    _id: '65f100000000000000000001',
    workspaceId: '65f100000000000000000002',
    userId: '65f100000000000000000003',
    roleKey: WORKSPACE_ROLES.AGENT,
    status: 'active',
    joinedAt: new Date('2026-05-27T00:00:00.000Z'),
    user: {
      _id: '65f100000000000000000003',
      email: 'agent@example.com',
      profile: {
        name: 'Agent Name',
        avatar: null,
      },
      status: 'active',
    },
  };

  test('owner/agent summaries include email and viewer summaries omit it', () => {
    const ownerView = buildWorkspaceMemberSummary({
      member,
      actorRoleKey: WORKSPACE_ROLES.OWNER,
    });
    const agentOption = buildWorkspaceMemberSummary({
      member,
      actorRoleKey: WORKSPACE_ROLES.AGENT,
      compact: true,
    });
    const viewerView = buildWorkspaceMemberSummary({
      member,
      actorRoleKey: WORKSPACE_ROLES.VIEWER,
    });
    const viewerOption = buildWorkspaceMemberSummary({
      member,
      actorRoleKey: WORKSPACE_ROLES.VIEWER,
      compact: true,
    });

    expect(ownerView.user.email).toBe('agent@example.com');
    expect(agentOption.email).toBe('agent@example.com');
    expect(viewerView.user.email).toBeUndefined();
    expect(viewerOption.email).toBeUndefined();
  });

  test('action response is compact and includes removedAt for removed members', () => {
    expect(
      buildWorkspaceMemberActionView({
        userId: '65f100000000000000000003',
        roleKey: WORKSPACE_ROLES.AGENT,
        status: 'suspended',
      })
    ).toEqual({
      userId: '65f100000000000000000003',
      roleKey: WORKSPACE_ROLES.AGENT,
      memberStatus: 'suspended',
    });

    expect(
      buildWorkspaceMemberActionView({
        userId: '65f100000000000000000003',
        roleKey: WORKSPACE_ROLES.AGENT,
        status: 'removed',
        removedAt: new Date('2026-05-27T00:00:00.000Z'),
      })
    ).toEqual({
      userId: '65f100000000000000000003',
      roleKey: WORKSPACE_ROLES.AGENT,
      memberStatus: 'removed',
      removedAt: new Date('2026-05-27T00:00:00.000Z'),
    });
  });
});

describe('workspace-members.service sorting', () => {
  test('email-hidden actors cannot sort or tie-break by email', () => {
    expect(
      buildWorkspaceMemberSort({
        sort: 'email',
        actorRoleKey: WORKSPACE_ROLES.VIEWER,
      })
    ).toEqual({ 'user.profile.name': 1, _id: 1 });

    expect(
      buildWorkspaceMemberSort({
        sort: '-email',
        actorRoleKey: WORKSPACE_ROLES.VIEWER,
      })
    ).toEqual({ 'user.profile.name': 1, _id: 1 });

    expect(
      buildWorkspaceMemberSort({
        sort: 'name',
        actorRoleKey: WORKSPACE_ROLES.VIEWER,
      })
    ).toEqual({ 'user.profile.name': 1, _id: 1 });
  });

  test('email-visible actors can sort by email', () => {
    expect(
      buildWorkspaceMemberSort({
        sort: 'email',
        actorRoleKey: WORKSPACE_ROLES.AGENT,
      })
    ).toEqual({ 'user.email': 1, _id: 1 });

    expect(
      buildWorkspaceMemberSort({
        sort: '-email',
        actorRoleKey: WORKSPACE_ROLES.OWNER,
      })
    ).toEqual({ 'user.email': -1, _id: 1 });
  });
});

describe('workspace-members.service authority and last-owner helpers', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('authority matrix allows owners and limits admins to agent/viewer targets and roles', () => {
    expect(
      assertWorkspaceMemberAuthority({
        actorUserId: 'owner-1',
        actorRoleKey: WORKSPACE_ROLES.OWNER,
        targetUserId: 'target-1',
        targetRoleKey: WORKSPACE_ROLES.ADMIN,
        nextRoleKey: WORKSPACE_ROLES.OWNER,
      })
    ).toBe(true);

    expect(
      assertWorkspaceMemberAuthority({
        actorUserId: 'admin-1',
        actorRoleKey: WORKSPACE_ROLES.ADMIN,
        targetUserId: 'target-1',
        targetRoleKey: WORKSPACE_ROLES.AGENT,
        nextRoleKey: WORKSPACE_ROLES.VIEWER,
      })
    ).toBe(true);

    expect(() =>
      assertWorkspaceMemberAuthority({
        actorUserId: 'admin-1',
        actorRoleKey: WORKSPACE_ROLES.ADMIN,
        targetUserId: 'target-1',
        targetRoleKey: WORKSPACE_ROLES.ADMIN,
      })
    ).toThrow(
      expect.objectContaining({
        messageKey: 'errors.workspace.cannotManageRole',
      })
    );

    expect(() =>
      assertWorkspaceMemberAuthority({
        actorUserId: 'admin-1',
        actorRoleKey: WORKSPACE_ROLES.ADMIN,
        targetUserId: 'target-1',
        targetRoleKey: WORKSPACE_ROLES.AGENT,
        nextRoleKey: WORKSPACE_ROLES.OWNER,
      })
    ).toThrow(
      expect.objectContaining({
        messageKey: 'errors.workspace.cannotManageRole',
      })
    );

    expect(() =>
      assertWorkspaceMemberAuthority({
        actorUserId: 'same-user',
        actorRoleKey: WORKSPACE_ROLES.OWNER,
        targetUserId: 'same-user',
        targetRoleKey: WORKSPACE_ROLES.AGENT,
      })
    ).toThrow(
      expect.objectContaining({
        messageKey: 'errors.workspace.cannotManageSelf',
      })
    );
  });

  test('last-owner helper blocks transitions that remove the final active owner', async () => {
    jest.spyOn(WorkspaceMember, 'countDocuments').mockResolvedValue(1);

    await expect(
      assertLastOwnerSafety({
        workspaceId: '65f100000000000000000002',
        targetRoleKey: WORKSPACE_ROLES.OWNER,
        targetStatus: 'active',
        nextRoleKey: WORKSPACE_ROLES.AGENT,
        nextStatus: 'active',
      })
    ).rejects.toMatchObject({
      messageKey: 'errors.workspace.lastOwnerRequired',
      statusCode: 409,
    });

    WorkspaceMember.countDocuments.mockResolvedValue(2);
    await expect(
      assertLastOwnerSafety({
        workspaceId: '65f100000000000000000002',
        targetRoleKey: WORKSPACE_ROLES.OWNER,
        targetStatus: 'active',
        nextRoleKey: WORKSPACE_ROLES.AGENT,
        nextStatus: 'active',
      })
    ).resolves.toBe(true);
  });
});
