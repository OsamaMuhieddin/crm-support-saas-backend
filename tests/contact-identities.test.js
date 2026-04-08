import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { Plan } from '../src/modules/billing/models/plan.model.js';
import { Subscription } from '../src/modules/billing/models/subscription.model.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { ContactIdentity } from '../src/modules/customers/models/contact-identity.model.js';
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

const CONTACT_IDENTITY_KEYS = [
  '_id',
  'workspaceId',
  'contactId',
  'type',
  'value',
  'verifiedAt',
  'createdAt',
  'updatedAt'
];

const expectExactKeys = (value, expectedKeys) => {
  expect(Object.keys(value).sort()).toEqual([...expectedKeys].sort());
};

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
  email = nextEmail('contact-identities-owner'),
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

const ensureWorkspaceCanInviteMembers = async (workspaceId) => {
  const businessPlan = await Plan.findOne({ key: 'business' }).select('_id key').lean();

  await Subscription.updateOne(
    { workspaceId, deletedAt: null },
    {
      $set: {
        planId: businessPlan?._id || undefined,
        planKey: 'business',
        status: 'active'
      }
    }
  );
};

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey }) => {
  await ensureWorkspaceCanInviteMembers(owner.workspaceId);

  const member = await createVerifiedUser({
    email: nextEmail(`contact-identities-${roleKey}`)
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

const createContactRecord = async ({
  workspaceId,
  fullName = 'Identity Contact',
  email = null
}) =>
  Contact.create({
    workspaceId,
    fullName,
    email
  });

const createContactIdentityRequest = ({
  accessToken,
  contactId,
  body
}) =>
  request(app)
    .post(`/api/customers/contacts/${contactId}/identities`)
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

describe('Customer contact identities v1 endpoints', () => {
  test('GET /api/customers/contacts/:id/identities requires authentication', async () => {
    const response = await request(app).get(
      `/api/customers/contacts/${new mongoose.Types.ObjectId()}/identities`
    );

    expect(response.status).toBe(401);
    expect(response.body.messageKey).toBe('errors.auth.invalidToken');
  });

  maybeDbTest(
    'owner, admin, and agent can create identities while viewer can only list them',
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
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
        fullName: 'Requester Identity Target'
      });

      const ownerCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: contact._id,
        body: {
          type: 'email',
          value: 'Owner.Identity@Example.com'
        }
      });

      expect(ownerCreate.status).toBe(200);
      expect(ownerCreate.body.messageKey).toBe('success.contactIdentity.created');
      expect(ownerCreate.body.identity.type).toBe('email');
      expect(ownerCreate.body.identity.value).toBe('owner.identity@example.com');
      expect(ownerCreate.body.identity.verifiedAt).toBeNull();
      expectExactKeys(ownerCreate.body.identity, CONTACT_IDENTITY_KEYS);

      const adminCreate = await createContactIdentityRequest({
        accessToken: admin.accessToken,
        contactId: contact._id,
        body: {
          type: 'phone',
          value: '+963 955 000 111'
        }
      });

      expect(adminCreate.status).toBe(200);
      expect(adminCreate.body.identity.type).toBe('phone');
      expect(adminCreate.body.identity.value).toBe('+963955000111');
      expectExactKeys(adminCreate.body.identity, CONTACT_IDENTITY_KEYS);

      const agentCreate = await createContactIdentityRequest({
        accessToken: agent.accessToken,
        contactId: contact._id,
        body: {
          type: 'whatsapp',
          value: '+963955000222'
        }
      });

      expect(agentCreate.status).toBe(200);
      expect(agentCreate.body.identity.type).toBe('whatsapp');
      expectExactKeys(agentCreate.body.identity, CONTACT_IDENTITY_KEYS);

      const viewerList = await request(app)
        .get(`/api/customers/contacts/${contact._id}/identities`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);

      expect(viewerList.status).toBe(200);
      expect(viewerList.body.identities).toHaveLength(3);
      for (const identity of viewerList.body.identities) {
        expectExactKeys(identity, CONTACT_IDENTITY_KEYS);
        expect(identity.valueNormalized).toBeUndefined();
      }

      const viewerCreate = await createContactIdentityRequest({
        accessToken: viewer.accessToken,
        contactId: contact._id,
        body: {
          type: 'email',
          value: 'viewer@example.com'
        }
      });

      expect(viewerCreate.status).toBe(403);
      expect(viewerCreate.body.messageKey).toBe('errors.auth.forbiddenRole');
    }
  );

  maybeDbTest(
    'list endpoint stays scoped to the parent contact and cross-workspace parents resolve as not found',
    async () => {
      const ownerA = await createVerifiedUser({
        email: nextEmail('contact-identities-scope-a')
      });
      const ownerB = await createVerifiedUser({
        email: nextEmail('contact-identities-scope-b')
      });
      const contactA = await createContactRecord({
        workspaceId: ownerA.workspaceId,
        fullName: 'Workspace A Primary'
      });
      const contactAOther = await createContactRecord({
        workspaceId: ownerA.workspaceId,
        fullName: 'Workspace A Secondary'
      });
      const contactB = await createContactRecord({
        workspaceId: ownerB.workspaceId,
        fullName: 'Workspace B Primary'
      });

      await ContactIdentity.create({
        workspaceId: ownerA.workspaceId,
        contactId: contactA._id,
        type: 'email',
        value: 'primary@example.com'
      });
      await ContactIdentity.create({
        workspaceId: ownerA.workspaceId,
        contactId: contactAOther._id,
        type: 'phone',
        value: '+963955111111'
      });
      await ContactIdentity.create({
        workspaceId: ownerB.workspaceId,
        contactId: contactB._id,
        type: 'whatsapp',
        value: '+963955222222'
      });

      const ownerAList = await request(app)
        .get(`/api/customers/contacts/${contactA._id}/identities`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);

      expect(ownerAList.status).toBe(200);
      expect(ownerAList.body.identities).toHaveLength(1);
      expect(ownerAList.body.identities[0].contactId).toBe(String(contactA._id));
      expectExactKeys(ownerAList.body.identities[0], CONTACT_IDENTITY_KEYS);

      const ownerBList = await request(app)
        .get(`/api/customers/contacts/${contactA._id}/identities`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);

      expect(ownerBList.status).toBe(404);
      expect(ownerBList.body.messageKey).toBe('errors.contact.notFound');

      const ownerBCreate = await createContactIdentityRequest({
        accessToken: ownerB.accessToken,
        contactId: contactA._id,
        body: {
          type: 'email',
          value: 'foreign@example.com'
        }
      });

      expect(ownerBCreate.status).toBe(404);
      expect(ownerBCreate.body.messageKey).toBe('errors.contact.notFound');
    }
  );

  maybeDbTest(
    'validation failures, duplicate conflicts, and invalid membership access use the standard envelope',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('contact-identities-validation-owner')
      });
      const firstContact = await createContactRecord({
        workspaceId: owner.workspaceId,
        fullName: 'First Identity Contact'
      });
      const secondContact = await createContactRecord({
        workspaceId: owner.workspaceId,
        fullName: 'Second Identity Contact'
      });

      const invalidId = await request(app)
        .get('/api/customers/contacts/not-an-id/identities')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(invalidId, 'id', 'errors.validation.invalidId');

      const unknownFieldCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {
          type: 'email',
          value: 'unknown@example.com',
          extra: true
        }
      });
      expectValidationError(
        unknownFieldCreate,
        'extra',
        'errors.validation.unknownField'
      );

      const missingFieldsCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {}
      });
      expect(missingFieldsCreate.status).toBe(422);
      expect(missingFieldsCreate.body.messageKey).toBe('errors.validation.failed');
      expect(missingFieldsCreate.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'type',
            messageKey: 'errors.validation.invalid'
          }),
          expect.objectContaining({
            field: 'value',
            messageKey: 'errors.validation.invalid'
          })
        ])
      );

      const invalidTypeCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {
          type: 'telegram',
          value: 'handle'
        }
      });
      expectValidationError(
        invalidTypeCreate,
        'type',
        'errors.validation.invalidEnum'
      );

      const invalidEmailCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {
          type: 'email',
          value: 'not-an-email'
        }
      });
      expectValidationError(
        invalidEmailCreate,
        'value',
        'errors.validation.invalidEmail'
      );

      const invalidPhoneCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {
          type: 'phone',
          value: 'abc'
        }
      });
      expectValidationError(
        invalidPhoneCreate,
        'value',
        'errors.validation.invalidPhone'
      );

      const created = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {
          type: 'email',
          value: 'duplicate@example.com'
        }
      });
      expect(created.status).toBe(200);

      const duplicate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: secondContact._id,
        body: {
          type: 'email',
          value: 'DUPLICATE@example.com'
        }
      });

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.messageKey).toBe('errors.contactIdentity.alreadyExists');
      expect(duplicate.body.message).not.toMatch(/E11000|duplicate key/i);

      const createdPhone = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: firstContact._id,
        body: {
          type: 'phone',
          value: '+963 (955)-444-333'
        }
      });
      expect(createdPhone.status).toBe(200);
      expect(createdPhone.body.identity.value).toBe('+963955444333');

      const duplicatePhone = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: secondContact._id,
        body: {
          type: 'phone',
          value: '+963955444333'
        }
      });

      expect(duplicatePhone.status).toBe(409);
      expect(duplicatePhone.body.messageKey).toBe(
        'errors.contactIdentity.alreadyExists'
      );
      expect(duplicatePhone.body.message).not.toMatch(/E11000|duplicate key/i);

      const nonexistentCreate = await createContactIdentityRequest({
        accessToken: owner.accessToken,
        contactId: new mongoose.Types.ObjectId(),
        body: {
          type: 'phone',
          value: '+963955333333'
        }
      });

      expect(nonexistentCreate.status).toBe(404);
      expect(nonexistentCreate.body.messageKey).toBe('errors.contact.notFound');

      await WorkspaceMember.deleteOne({
        workspaceId: owner.workspaceId,
        userId: new mongoose.Types.ObjectId(owner.userId)
      });

      const forbiddenTenant = await request(app)
        .get(`/api/customers/contacts/${firstContact._id}/identities`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(forbiddenTenant.status).toBe(403);
      expect(forbiddenTenant.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );
    }
  );
});
