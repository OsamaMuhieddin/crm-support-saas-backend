import request from 'supertest';
import { jest } from '@jest/globals';
import app from '../src/app.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { backfillWorkspaceDefaultMailboxes } from '../src/modules/mailboxes/services/mailboxes.service.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Test User',
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
    email,
    password,
    userId: verify.body.user._id,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
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
  const member = await createVerifiedUser({ email });

  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.email,
    roleKey,
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app).post('/api/workspaces/invites/accept').send({
    token: invite.token,
    email: member.email,
  });
  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email: member.email,
    password: member.password,
  });
  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId: owner.workspaceId });

  expect(switched.status).toBe(200);
  expect(switched.body.accessToken).toBeTruthy();

  return {
    accessToken: switched.body.accessToken,
    email: member.email,
  };
};

const createMailbox = async ({
  accessToken,
  name,
  emailAddress = null,
  fromName = null,
}) => {
  const body = { name };

  if (emailAddress !== null) {
    body.emailAddress = emailAddress;
  }
  if (fromName !== null) {
    body.fromName = fromName;
  }

  const response = await request(app)
    .post('/api/mailboxes')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

  return response;
};

describe('Mailbox v1 endpoints + workspace bootstrap/backfill', () => {
  maybeDbTest(
    'workspace bootstrap creates one default mailbox and login does not duplicate it',
    async () => {
      const owner = await createVerifiedUser({
        email: 'mailbox-bootstrap-owner@example.com',
      });

      const workspace = await Workspace.findById(owner.workspaceId).lean();
      expect(workspace).toBeTruthy();
      expect(workspace.defaultMailboxId).toBeTruthy();

      const initialMailboxes = await Mailbox.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
      }).lean();

      expect(initialMailboxes).toHaveLength(1);
      expect(initialMailboxes[0].name).toBe('Support');
      expect(initialMailboxes[0].isDefault).toBe(true);
      expect(initialMailboxes[0].isActive).toBe(true);
      expect(String(workspace.defaultMailboxId)).toBe(
        String(initialMailboxes[0]._id)
      );

      const login = await request(app).post('/api/auth/login').send({
        email: owner.email,
        password: owner.password,
      });

      expect(login.status).toBe(200);

      const afterLoginMailboxes = await Mailbox.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
      }).lean();

      const defaultsAfterLogin = afterLoginMailboxes.filter(
        (mailbox) => mailbox.isDefault
      );
      expect(defaultsAfterLogin).toHaveLength(1);
      expect(afterLoginMailboxes).toHaveLength(1);
    }
  );

  maybeDbTest(
    'backfill creates and keeps a single default mailbox when workspace default is missing',
    async () => {
      const owner = await createVerifiedUser({
        email: 'mailbox-backfill-owner@example.com',
      });

      await Mailbox.deleteMany({ workspaceId: owner.workspaceId });
      await Workspace.updateOne(
        { _id: owner.workspaceId },
        { $set: { defaultMailboxId: null } }
      );

      const firstRun = await backfillWorkspaceDefaultMailboxes();
      expect(firstRun.scanned).toBeGreaterThan(0);
      expect(firstRun.changed).toBeGreaterThan(0);
      expect(firstRun.createdDefault).toBeGreaterThan(0);

      const workspaceAfterFirstRun = await Workspace.findById(
        owner.workspaceId
      ).lean();
      const mailboxesAfterFirstRun = await Mailbox.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
      }).lean();

      expect(workspaceAfterFirstRun.defaultMailboxId).toBeTruthy();
      expect(mailboxesAfterFirstRun).toHaveLength(1);
      expect(mailboxesAfterFirstRun[0].name).toBe('Support');
      expect(mailboxesAfterFirstRun[0].isDefault).toBe(true);
      expect(mailboxesAfterFirstRun[0].isActive).toBe(true);
      expect(String(workspaceAfterFirstRun.defaultMailboxId)).toBe(
        String(mailboxesAfterFirstRun[0]._id)
      );

      await backfillWorkspaceDefaultMailboxes();

      const finalMailboxes = await Mailbox.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
      }).lean();
      const finalDefaults = finalMailboxes.filter((mailbox) => mailbox.isDefault);

      expect(finalMailboxes).toHaveLength(1);
      expect(finalDefaults).toHaveLength(1);
    }
  );

  maybeDbTest('owner and admin can create mailbox', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-owner-create@example.com',
    });

    const ownerCreate = await createMailbox({
      accessToken: owner.accessToken,
      name: 'Billing Queue',
      emailAddress: 'billing@example.com',
    });

    expect(ownerCreate.status).toBe(200);
    expect(ownerCreate.body.messageKey).toBe('success.mailbox.created');
    expect(ownerCreate.body.mailbox.name).toBe('Billing Queue');

    const admin = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.ADMIN,
      email: 'mailbox-admin-create@example.com',
    });

    const adminCreate = await createMailbox({
      accessToken: admin.accessToken,
      name: 'Sales Queue',
      emailAddress: 'sales@example.com',
    });

    expect(adminCreate.status).toBe(200);
    expect(adminCreate.body.messageKey).toBe('success.mailbox.created');
    expect(adminCreate.body.mailbox.name).toBe('Sales Queue');
  });

  maybeDbTest('create rejects unsupported mailbox type values in v1', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-type-create-owner@example.com',
    });

    const response = await request(app)
      .post('/api/mailboxes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Chat Queue',
        type: 'chat',
      });

    expect(response.status).toBe(422);
    expect(response.body.messageKey).toBe('errors.validation.failed');
    expect(response.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'type',
          messageKey: 'errors.validation.invalidEnum',
        }),
      ])
    );
  });

  maybeDbTest('patch rejects unknown fields and unsupported mailbox type values', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-type-patch-owner@example.com',
    });

    const created = await createMailbox({
      accessToken: owner.accessToken,
      name: 'Patch Validation Queue',
      emailAddress: 'patch-validation@example.com',
    });
    expect(created.status).toBe(200);

    const unknownFieldPatch = await request(app)
      .patch(`/api/mailboxes/${created.body.mailbox._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Renamed Queue',
        unknownField: 'should-fail',
      });

    expect(unknownFieldPatch.status).toBe(422);
    expect(unknownFieldPatch.body.messageKey).toBe('errors.validation.failed');
    expect(unknownFieldPatch.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'unknownField',
          messageKey: 'errors.validation.unknownField',
        }),
      ])
    );

    const invalidTypePatch = await request(app)
      .patch(`/api/mailboxes/${created.body.mailbox._id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        type: 'form',
      });

    expect(invalidTypePatch.status).toBe(422);
    expect(invalidTypePatch.body.messageKey).toBe('errors.validation.failed');
    expect(invalidTypePatch.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'type',
          messageKey: 'errors.validation.invalidEnum',
        }),
      ])
    );
  });

  maybeDbTest('mailbox mutations fail with workspace not found when workspace is soft-deleted', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-workspace-missing-owner@example.com',
    });

    await Workspace.updateOne(
      { _id: owner.workspaceId },
      { $set: { deletedAt: new Date('2026-01-01T00:00:00.000Z') } }
    );

    const response = await request(app)
      .post('/api/mailboxes')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        name: 'Should Fail Missing Workspace',
        emailAddress: 'workspace-missing@example.com',
      });

    expect(response.status).toBe(404);
    expect(response.body.messageKey).toBe('errors.workspace.notFound');
  });

  maybeDbTest('agent and viewer cannot mutate mailbox state', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-mutate-owner@example.com',
    });

    const mailboxResponse = await createMailbox({
      accessToken: owner.accessToken,
      name: 'Operations Queue',
      emailAddress: 'ops@example.com',
    });
    expect(mailboxResponse.status).toBe(200);

    const agent = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.AGENT,
      email: 'mailbox-mutate-agent@example.com',
    });
    const viewer = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.VIEWER,
      email: 'mailbox-mutate-viewer@example.com',
    });

    const agentCreate = await createMailbox({
      accessToken: agent.accessToken,
      name: 'Should Fail Agent',
      emailAddress: 'fail-agent@example.com',
    });
    expect(agentCreate.status).toBe(403);
    expect(agentCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

    const viewerCreate = await createMailbox({
      accessToken: viewer.accessToken,
      name: 'Should Fail Viewer',
      emailAddress: 'fail-viewer@example.com',
    });
    expect(viewerCreate.status).toBe(403);
    expect(viewerCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

    const agentSetDefault = await request(app)
      .post(`/api/mailboxes/${mailboxResponse.body.mailbox._id}/set-default`)
      .set('Authorization', `Bearer ${agent.accessToken}`)
      .send({});
    expect(agentSetDefault.status).toBe(403);
    expect(agentSetDefault.body.messageKey).toBe('errors.auth.forbiddenRole');
  });

  maybeDbTest(
    'read endpoints are workspace-isolated and hide inactive mailboxes from non-admin roles',
    async () => {
      const workspaceAOwner = await createVerifiedUser({
        email: 'mailbox-isolation-owner-a@example.com',
      });
      const workspaceBOwner = await createVerifiedUser({
        email: 'mailbox-isolation-owner-b@example.com',
      });

      const mailboxA = await createMailbox({
        accessToken: workspaceAOwner.accessToken,
        name: 'Workspace A Queue',
        emailAddress: 'workspace-a@example.com',
      });
      expect(mailboxA.status).toBe(200);

      const mailboxB = await createMailbox({
        accessToken: workspaceBOwner.accessToken,
        name: 'Workspace B Queue',
        emailAddress: 'workspace-b@example.com',
      });
      expect(mailboxB.status).toBe(200);

      const workspaceBGetA = await request(app)
        .get(`/api/mailboxes/${mailboxA.body.mailbox._id}`)
        .set('Authorization', `Bearer ${workspaceBOwner.accessToken}`);
      expect(workspaceBGetA.status).toBe(404);
      expect(workspaceBGetA.body.messageKey).toBe('errors.mailbox.notFound');

      const workspaceAList = await request(app)
        .get('/api/mailboxes')
        .set('Authorization', `Bearer ${workspaceAOwner.accessToken}`);
      expect(workspaceAList.status).toBe(200);
      const workspaceAIds = new Set(
        workspaceAList.body.mailboxes.map((mailbox) => mailbox._id)
      );
      expect(workspaceAIds.has(mailboxA.body.mailbox._id)).toBe(true);
      expect(workspaceAIds.has(mailboxB.body.mailbox._id)).toBe(false);

      const agent = await createWorkspaceScopedTokenForRole({
        owner: workspaceAOwner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'mailbox-isolation-agent-a@example.com',
      });

      const deactivateA = await request(app)
        .post(`/api/mailboxes/${mailboxA.body.mailbox._id}/deactivate`)
        .set('Authorization', `Bearer ${workspaceAOwner.accessToken}`)
        .send({});
      expect(deactivateA.status).toBe(200);

      const agentGetInactive = await request(app)
        .get(`/api/mailboxes/${mailboxA.body.mailbox._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentGetInactive.status).toBe(404);
      expect(agentGetInactive.body.messageKey).toBe('errors.mailbox.notFound');
    }
  );

  maybeDbTest(
    'set-default updates mailbox flags and workspace.defaultMailboxId consistently',
    async () => {
      const owner = await createVerifiedUser({
        email: 'mailbox-default-sync-owner@example.com',
      });

      const newMailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Secondary Support',
        emailAddress: 'secondary@example.com',
      });
      expect(newMailbox.status).toBe(200);

      const setDefaultResponse = await request(app)
        .post(`/api/mailboxes/${newMailbox.body.mailbox._id}/set-default`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(setDefaultResponse.status).toBe(200);
      expect(setDefaultResponse.body.messageKey).toBe('success.mailbox.defaultSet');
      expect(setDefaultResponse.body.mailbox.isDefault).toBe(true);

      const workspace = await Workspace.findById(owner.workspaceId).lean();
      expect(String(workspace.defaultMailboxId)).toBe(
        String(newMailbox.body.mailbox._id)
      );

      const defaults = await Mailbox.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
        isDefault: true,
      }).lean();
      expect(defaults).toHaveLength(1);
      expect(String(defaults[0]._id)).toBe(String(newMailbox.body.mailbox._id));
    }
  );

  maybeDbTest(
    'set-default performs best-effort workspace pointer re-sync after transient update failure',
    async () => {
      const owner = await createVerifiedUser({
        email: 'mailbox-default-resync-owner@example.com',
      });

      const newMailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Transient Failure Queue',
        emailAddress: 'transient-failure@example.com',
      });
      expect(newMailbox.status).toBe(200);

      const updateSpy = jest
        .spyOn(Workspace, 'updateOne')
        .mockImplementationOnce(() => {
          throw new Error('workspace-pointer-write-failed');
        });
      let updateCallCount = 0;

      try {
        const response = await request(app)
          .post(`/api/mailboxes/${newMailbox.body.mailbox._id}/set-default`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({});

        expect(response.status).toBe(200);
        expect(response.body.messageKey).toBe('success.mailbox.defaultSet');
        expect(response.body.mailbox.isDefault).toBe(true);
        expect(response.body.mailbox.isActive).toBe(true);
      } finally {
        updateCallCount = updateSpy.mock.calls.length;
        updateSpy.mockRestore();
      }

      expect(updateCallCount).toBeGreaterThanOrEqual(2);

      const workspace = await Workspace.findById(owner.workspaceId).lean();
      expect(String(workspace.defaultMailboxId)).toBe(
        String(newMailbox.body.mailbox._id)
      );

      const defaults = await Mailbox.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
        isDefault: true,
      }).lean();
      expect(defaults).toHaveLength(1);
      expect(String(defaults[0]._id)).toBe(String(newMailbox.body.mailbox._id));
      expect(defaults[0].isActive).toBe(true);
    }
  );

  maybeDbTest('cannot deactivate default mailbox', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-default-deactivate-owner@example.com',
    });

    const workspace = await Workspace.findById(owner.workspaceId).lean();
    const defaultMailboxId = String(workspace.defaultMailboxId);

    const deactivateDefault = await request(app)
      .post(`/api/mailboxes/${defaultMailboxId}/deactivate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(deactivateDefault.status).toBe(409);
    expect(deactivateDefault.body.messageKey).toBe(
      'errors.mailbox.defaultCannotDeactivate'
    );
  });

  maybeDbTest('cannot deactivate last active mailbox', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-last-active-owner@example.com',
    });

    const mailbox = await createMailbox({
      accessToken: owner.accessToken,
      name: 'Only Active Queue',
      emailAddress: 'only-active@example.com',
    });
    expect(mailbox.status).toBe(200);

    const workspace = await Workspace.findById(owner.workspaceId).lean();
    await Mailbox.updateOne(
      { _id: workspace.defaultMailboxId, workspaceId: owner.workspaceId },
      { $set: { isActive: false } }
    );

    const deactivateLastActive = await request(app)
      .post(`/api/mailboxes/${mailbox.body.mailbox._id}/deactivate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    expect(deactivateLastActive.status).toBe(409);
    expect(deactivateLastActive.body.messageKey).toBe(
      'errors.mailbox.lastActiveCannotDeactivate'
    );
  });

  maybeDbTest('options endpoint returns active-only by default', async () => {
    const owner = await createVerifiedUser({
      email: 'mailbox-options-owner@example.com',
    });

    const inactiveMailbox = await createMailbox({
      accessToken: owner.accessToken,
      name: 'Inactive Queue',
      emailAddress: 'inactive-queue@example.com',
    });
    expect(inactiveMailbox.status).toBe(200);

    const deactivate = await request(app)
      .post(`/api/mailboxes/${inactiveMailbox.body.mailbox._id}/deactivate`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});
    expect(deactivate.status).toBe(200);

    const optionsDefault = await request(app)
      .get('/api/mailboxes/options')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(optionsDefault.status).toBe(200);

    const defaultIds = new Set(optionsDefault.body.options.map((x) => x._id));
    expect(defaultIds.has(inactiveMailbox.body.mailbox._id)).toBe(false);

    const optionsWithInactive = await request(app)
      .get('/api/mailboxes/options?includeInactive=true')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(optionsWithInactive.status).toBe(200);

    const withInactiveIds = new Set(
      optionsWithInactive.body.options.map((x) => x._id)
    );
    expect(withInactiveIds.has(inactiveMailbox.body.mailbox._id)).toBe(true);
  });

  maybeDbTest(
    'list endpoint supports active default behavior, filtering, search, and pagination',
    async () => {
      const owner = await createVerifiedUser({
        email: 'mailbox-list-owner@example.com',
      });

      const alpha = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Alpha Queue',
        emailAddress: 'alpha@example.com',
      });
      const beta = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Beta Queue',
        emailAddress: 'beta@example.com',
      });
      const gamma = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Gamma Queue',
        emailAddress: 'gamma@example.com',
      });

      expect(alpha.status).toBe(200);
      expect(beta.status).toBe(200);
      expect(gamma.status).toBe(200);

      const deactivateBeta = await request(app)
        .post(`/api/mailboxes/${beta.body.mailbox._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivateBeta.status).toBe(200);

      const defaultList = await request(app)
        .get('/api/mailboxes')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(defaultList.status).toBe(200);

      const defaultIds = new Set(defaultList.body.mailboxes.map((x) => x._id));
      expect(defaultIds.has(beta.body.mailbox._id)).toBe(false);
      expect(defaultList.body.page).toBe(1);
      expect(defaultList.body.limit).toBe(20);

      const inactiveOnly = await request(app)
        .get('/api/mailboxes?includeInactive=true&isActive=false')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(inactiveOnly.status).toBe(200);
      expect(inactiveOnly.body.mailboxes).toHaveLength(1);
      expect(inactiveOnly.body.mailboxes[0]._id).toBe(beta.body.mailbox._id);

      const searchList = await request(app)
        .get('/api/mailboxes?q=alpha')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(searchList.status).toBe(200);
      expect(searchList.body.mailboxes).toHaveLength(1);
      expect(searchList.body.mailboxes[0]._id).toBe(alpha.body.mailbox._id);

      const pagedList = await request(app)
        .get('/api/mailboxes?page=1&limit=1&sort=name')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(pagedList.status).toBe(200);
      expect(pagedList.body.page).toBe(1);
      expect(pagedList.body.limit).toBe(1);
      expect(pagedList.body.results).toBe(1);
      expect(pagedList.body.total).toBeGreaterThan(1);
    }
  );

  maybeDbTest('multi-workspace mailbox isolation is preserved across list/options/get', async () => {
    const ownerA = await createVerifiedUser({
      email: 'mailbox-multi-workspace-owner-a@example.com',
    });
    const ownerB = await createVerifiedUser({
      email: 'mailbox-multi-workspace-owner-b@example.com',
    });

    const mailboxA = await createMailbox({
      accessToken: ownerA.accessToken,
      name: 'Queue A',
      emailAddress: 'qa@example.com',
    });
    const mailboxB = await createMailbox({
      accessToken: ownerB.accessToken,
      name: 'Queue B',
      emailAddress: 'qb@example.com',
    });

    expect(mailboxA.status).toBe(200);
    expect(mailboxB.status).toBe(200);

    const ownerAList = await request(app)
      .get('/api/mailboxes')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(ownerAList.status).toBe(200);
    const ownerAIds = new Set(ownerAList.body.mailboxes.map((x) => x._id));
    expect(ownerAIds.has(mailboxA.body.mailbox._id)).toBe(true);
    expect(ownerAIds.has(mailboxB.body.mailbox._id)).toBe(false);

    const ownerAOptions = await request(app)
      .get('/api/mailboxes/options')
      .set('Authorization', `Bearer ${ownerA.accessToken}`);
    expect(ownerAOptions.status).toBe(200);
    const ownerAOptionIds = new Set(ownerAOptions.body.options.map((x) => x._id));
    expect(ownerAOptionIds.has(mailboxA.body.mailbox._id)).toBe(true);
    expect(ownerAOptionIds.has(mailboxB.body.mailbox._id)).toBe(false);

    const ownerBGetA = await request(app)
      .get(`/api/mailboxes/${mailboxA.body.mailbox._id}`)
      .set('Authorization', `Bearer ${ownerB.accessToken}`);
    expect(ownerBGetA.status).toBe(404);
    expect(ownerBGetA.body.messageKey).toBe('errors.mailbox.notFound');
  });
});
