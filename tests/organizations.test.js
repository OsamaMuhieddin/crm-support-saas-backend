import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { WorkspaceMember } from '../src/modules/workspaces/models/workspace-member.model.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs
} from './helpers/email-capture.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

let sequence = 0;

const nextValue = (prefix) => {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
};

const nextEmail = (prefix) => `${nextValue(prefix)}@example.com`;

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = 'Test User'
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({ email, password, name })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs)
  };
};

const createVerifiedUser = async ({
  email = nextEmail('organizations-owner'),
  password = 'Password123!',
  name = 'Test User'
} = {}) => {
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
    userId: verify.body.user._id,
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId
  };
};

const createInviteWithToken = async ({
  workspaceId,
  accessToken,
  email,
  roleKey
}) => {
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

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey }) => {
  const member = await createVerifiedUser({
    email: nextEmail(`organizations-${roleKey}`)
  });

  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.email,
    roleKey
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app).post('/api/workspaces/invites/accept').send({
    token: invite.token,
    email: member.email
  });
  expect(accept.status).toBe(200);

  const login = await request(app).post('/api/auth/login').send({
    email: member.email,
    password: member.password
  });
  expect(login.status).toBe(200);

  const switched = await request(app)
    .post('/api/workspaces/switch')
    .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
    .send({ workspaceId: owner.workspaceId });

  expect(switched.status).toBe(200);
  expect(switched.body.accessToken).toBeTruthy();

  return {
    userId: member.userId,
    email: member.email,
    accessToken: switched.body.accessToken
  };
};

const createOrganizationRequest = ({ accessToken, body }) =>
  request(app)
    .post('/api/customers/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const expectValidationError = (response, field, messageKey) => {
  expect(response.status).toBe(422);
  expect(response.body.messageKey).toBe('errors.validation.failed');
  expect(response.body.errors).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        field,
        messageKey
      })
    ])
  );
};

const ORGANIZATION_RESOURCE_KEYS = [
  '_id',
  'workspaceId',
  'name',
  'domain',
  'notes',
  'createdAt',
  'updatedAt'
];

const ORGANIZATION_OPTION_KEYS = ['_id', 'name', 'domain'];

const expectExactKeys = (value, expectedKeys) => {
  expect(Object.keys(value).sort()).toEqual([...expectedKeys].sort());
};

describe('Customer organizations v1 endpoints', () => {
  test('GET /api/customers/organizations requires authentication', async () => {
    const response = await request(app).get('/api/customers/organizations');

    expect(response.status).toBe(401);
    expect(response.body.messageKey).toBe('errors.auth.invalidToken');
  });

  maybeDbTest(
    'owner, admin, and agent can create organizations while viewer remains read-only',
    async () => {
      const owner = await createVerifiedUser();
      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER
      });

      const ownerCreate = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Acme Owner Org',
          domain: '  ACME.EXAMPLE  ',
          notes: 'Priority customer'
        }
      });

      expect(ownerCreate.status).toBe(200);
      expect(ownerCreate.body.messageKey).toBe('success.organization.created');
      expect(ownerCreate.body.organization.name).toBe('Acme Owner Org');
      expect(ownerCreate.body.organization.domain).toBe('acme.example');
      expect(ownerCreate.body.organization.workspaceId).toBe(owner.workspaceId);
      expectExactKeys(ownerCreate.body.organization, ORGANIZATION_RESOURCE_KEYS);

      const adminCreate = await createOrganizationRequest({
        accessToken: admin.accessToken,
        body: {
          name: 'Admin Org',
          domain: 'admin.example'
        }
      });

      expect(adminCreate.status).toBe(200);
      expect(adminCreate.body.organization.name).toBe('Admin Org');

      const agentCreate = await createOrganizationRequest({
        accessToken: agent.accessToken,
        body: {
          name: 'Agent Org'
        }
      });

      expect(agentCreate.status).toBe(200);
      expect(agentCreate.body.organization.name).toBe('Agent Org');

      const viewerList = await request(app)
        .get('/api/customers/organizations')
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerList.status).toBe(200);
      expect(viewerList.body.organizations.length).toBeGreaterThanOrEqual(3);

      const viewerCreate = await createOrganizationRequest({
        accessToken: viewer.accessToken,
        body: {
          name: 'Viewer Org'
        }
      });

      expect(viewerCreate.status).toBe(403);
      expect(viewerCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

      const viewerUpdate = await request(app)
        .patch(`/api/customers/organizations/${ownerCreate.body.organization._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ notes: 'Should fail' });

      expect(viewerUpdate.status).toBe(403);
      expect(viewerUpdate.body.messageKey).toBe('errors.auth.forbiddenRole');
    }
  );

  maybeDbTest(
    'list and options endpoints support pagination, search, exact domain filtering, sort, and workspace isolation',
    async () => {
      const ownerA = await createVerifiedUser({
        email: nextEmail('organizations-list-a')
      });
      const ownerB = await createVerifiedUser({
        email: nextEmail('organizations-list-b')
      });

      const alpha = await createOrganizationRequest({
        accessToken: ownerA.accessToken,
        body: {
          name: 'Acme Alpha',
          domain: 'alpha.example',
          notes: 'Alpha notes'
        }
      });
      const beta = await createOrganizationRequest({
        accessToken: ownerA.accessToken,
        body: {
          name: 'Beta Group',
          domain: 'beta.example'
        }
      });
      const gamma = await createOrganizationRequest({
        accessToken: ownerA.accessToken,
        body: {
          name: 'Acme Gamma',
          domain: 'gamma.example'
        }
      });
      const foreign = await createOrganizationRequest({
        accessToken: ownerB.accessToken,
        body: {
          name: 'Workspace B Org',
          domain: 'workspace-b.example'
        }
      });

      expect(alpha.status).toBe(200);
      expect(beta.status).toBe(200);
      expect(gamma.status).toBe(200);
      expect(foreign.status).toBe(200);

      const searchList = await request(app)
        .get('/api/customers/organizations?q=acme')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(searchList.status).toBe(200);
      expect(searchList.body.organizations).toHaveLength(2);
      for (const organization of searchList.body.organizations) {
        expectExactKeys(organization, ORGANIZATION_RESOURCE_KEYS);
      }
      expect(
        searchList.body.organizations.every((organization) =>
          organization.name.toLowerCase().includes('acme')
        )
      ).toBe(true);

      const domainFilter = await request(app)
        .get('/api/customers/organizations?domain=beta.example')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(domainFilter.status).toBe(200);
      expect(domainFilter.body.organizations).toHaveLength(1);
      expect(domainFilter.body.organizations[0]._id).toBe(
        beta.body.organization._id
      );

      const pagedList = await request(app)
        .get('/api/customers/organizations?page=1&limit=1&sort=name')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(pagedList.status).toBe(200);
      expect(pagedList.body.page).toBe(1);
      expect(pagedList.body.limit).toBe(1);
      expect(pagedList.body.results).toBe(1);
      expect(pagedList.body.total).toBe(3);

      const options = await request(app)
        .get('/api/customers/organizations/options?search=acme')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(options.status).toBe(200);
      expect(options.body.options).toHaveLength(2);
      for (const option of options.body.options) {
        expect(option).toEqual(
          expect.objectContaining({
            _id: expect.any(String),
            name: expect.any(String)
          })
        );
        expectExactKeys(option, ORGANIZATION_OPTION_KEYS);
      }

      const ownerBList = await request(app)
        .get('/api/customers/organizations')
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(ownerBList.status).toBe(200);

      const ownerBIds = new Set(
        ownerBList.body.organizations.map((organization) => organization._id)
      );
      expect(ownerBIds.has(foreign.body.organization._id)).toBe(true);
      expect(ownerBIds.has(alpha.body.organization._id)).toBe(false);
      expect(ownerBIds.has(gamma.body.organization._id)).toBe(false);
    }
  );

  maybeDbTest(
    'viewer can read organization details and agent can update allowed fields',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('organizations-read-update-owner')
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER
      });

      const created = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Detail Org',
          domain: 'detail.example',
          notes: 'Original notes'
        }
      });
      expect(created.status).toBe(200);

      const detail = await request(app)
        .get(`/api/customers/organizations/${created.body.organization._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.organization.name).toBe('Detail Org');
      expect(detail.body.organization.notes).toBe('Original notes');
      expectExactKeys(detail.body.organization, ORGANIZATION_RESOURCE_KEYS);

      const updated = await request(app)
        .patch(`/api/customers/organizations/${created.body.organization._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({
          domain: 'UPDATED.EXAMPLE',
          notes: null
        });

      expect(updated.status).toBe(200);
      expect(updated.body.messageKey).toBe('success.organization.updated');
      expect(updated.body.organization.domain).toBe('updated.example');
      expect(updated.body.organization.notes).toBeNull();
      expectExactKeys(updated.body.organization, ORGANIZATION_RESOURCE_KEYS);

      const detailAfterUpdate = await request(app)
        .get(`/api/customers/organizations/${created.body.organization._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(detailAfterUpdate.status).toBe(200);
      expect(detailAfterUpdate.body.organization.domain).toBe('updated.example');
      expect(detailAfterUpdate.body.organization.notes).toBeNull();
      expectExactKeys(
        detailAfterUpdate.body.organization,
        ORGANIZATION_RESOURCE_KEYS
      );
    }
  );

  maybeDbTest(
    'validation failures and invalid membership access use the standard envelope',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('organizations-validation-owner')
      });

      const unknownFieldCreate = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Invalid Org',
          unknownField: 'not-allowed'
        }
      });
      expectValidationError(
        unknownFieldCreate,
        'unknownField',
        'errors.validation.unknownField'
      );

      const invalidDomainCreate = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Invalid Domain Org',
          domain: 'not a domain'
        }
      });
      expectValidationError(
        invalidDomainCreate,
        'domain',
        'errors.validation.invalidDomain'
      );

      const invalidListQuery = await request(app)
        .get('/api/customers/organizations?limit=101&sort=bad&domain=not-a-domain')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(invalidListQuery.status).toBe(422);
      expect(invalidListQuery.body.messageKey).toBe('errors.validation.failed');
      expect(invalidListQuery.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'limit',
            messageKey: 'errors.validation.invalidNumber'
          }),
          expect.objectContaining({
            field: 'sort',
            messageKey: 'errors.validation.invalidEnum'
          }),
          expect.objectContaining({
            field: 'domain',
            messageKey: 'errors.validation.invalidDomain'
          })
        ])
      );

      const invalidId = await request(app)
        .get('/api/customers/organizations/not-an-id')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(invalidId, 'id', 'errors.validation.invalidId');

      const created = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Patch Target'
        }
      });
      expect(created.status).toBe(200);

      const emptyPatch = await request(app)
        .patch(`/api/customers/organizations/${created.body.organization._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expectValidationError(
        emptyPatch,
        'body',
        'errors.validation.bodyRequiresAtLeastOneField'
      );

      await WorkspaceMember.deleteOne({
        workspaceId: owner.workspaceId,
        userId: new mongoose.Types.ObjectId(owner.userId)
      });

      const forbiddenTenant = await request(app)
        .get('/api/customers/organizations')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(forbiddenTenant.status).toBe(403);
      expect(forbiddenTenant.body.messageKey).toBe('errors.auth.forbiddenTenant');
    }
  );

  maybeDbTest(
    'cross-workspace and nonexistent organizations resolve as not found',
    async () => {
      const ownerA = await createVerifiedUser({
        email: nextEmail('organizations-isolation-a')
      });
      const ownerB = await createVerifiedUser({
        email: nextEmail('organizations-isolation-b')
      });

      const created = await createOrganizationRequest({
        accessToken: ownerA.accessToken,
        body: {
          name: 'Workspace A Org',
          domain: 'workspace-a.example'
        }
      });
      expect(created.status).toBe(200);

      const ownerBGet = await request(app)
        .get(`/api/customers/organizations/${created.body.organization._id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(ownerBGet.status).toBe(404);
      expect(ownerBGet.body.messageKey).toBe('errors.organization.notFound');

      const ownerBPatch = await request(app)
        .patch(`/api/customers/organizations/${created.body.organization._id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ notes: 'Should not work' });
      expect(ownerBPatch.status).toBe(404);
      expect(ownerBPatch.body.messageKey).toBe('errors.organization.notFound');

      const nonexistentGet = await request(app)
        .get(`/api/customers/organizations/${new mongoose.Types.ObjectId()}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(nonexistentGet.status).toBe(404);
      expect(nonexistentGet.body.messageKey).toBe('errors.organization.notFound');
    }
  );
});
