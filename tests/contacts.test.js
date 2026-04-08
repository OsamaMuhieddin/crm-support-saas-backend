import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { Plan } from '../src/modules/billing/models/plan.model.js';
import { Subscription } from '../src/modules/billing/models/subscription.model.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { Organization } from '../src/modules/customers/models/organization.model.js';
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
  email = nextEmail('contacts-owner'),
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
    email: nextEmail(`contacts-${roleKey}`)
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

const createOrganizationRecord = async ({
  workspaceId,
  name = nextValue('Contact Org'),
  domain = `${nextValue('contact-org')}.example.com`
}) =>
  Organization.create({
    workspaceId,
    name,
    domain
  });

const createContactRequest = ({ accessToken, body }) =>
  request(app)
    .post('/api/customers/contacts')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const createOrganizationRequest = ({ accessToken, body }) =>
  request(app)
    .post('/api/customers/organizations')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const createTicketRequest = ({ accessToken, body }) =>
  request(app)
    .post('/api/tickets')
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

const CONTACT_RESOURCE_KEYS = [
  '_id',
  'workspaceId',
  'organizationId',
  'organization',
  'fullName',
  'email',
  'phone',
  'tags',
  'customFields',
  'createdAt',
  'updatedAt'
];

const CONTACT_LIST_KEYS = [
  '_id',
  'workspaceId',
  'organizationId',
  'organization',
  'fullName',
  'email',
  'phone',
  'tags',
  'createdAt',
  'updatedAt'
];

const CONTACT_OPTION_KEYS = [
  '_id',
  'fullName',
  'email',
  'phone',
  'organizationId',
  'organization'
];

const TICKET_CONTACT_SUMMARY_KEYS = [
  '_id',
  'organizationId',
  'fullName',
  'email',
  'phone'
];

const TICKET_ORGANIZATION_SUMMARY_KEYS = ['_id', 'name', 'domain'];

const expectExactKeys = (value, expectedKeys) => {
  expect(Object.keys(value).sort()).toEqual([...expectedKeys].sort());
};

describe('Customer contacts v1 endpoints', () => {
  test('GET /api/customers/contacts requires authentication', async () => {
    const response = await request(app).get('/api/customers/contacts');

    expect(response.status).toBe(401);
    expect(response.body.messageKey).toBe('errors.auth.invalidToken');
  });

  maybeDbTest(
    'owner, admin, and agent can create contacts across allowed input shapes while viewer remains read-only',
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
      const organization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
        name: 'Acme Org',
        domain: 'acme.example'
      });

      const ownerCreate = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: '  Jane Requester  ',
          organizationId: String(organization._id),
          email: '  JANE.REQUESTER@EXAMPLE.COM  ',
          tags: [' VIP '],
          customFields: {
            source: '  Manual  '
          }
        }
      });

      expect(ownerCreate.status).toBe(200);
      expect(ownerCreate.body.messageKey).toBe('success.contact.created');
      expect(ownerCreate.body.contact.fullName).toBe('Jane Requester');
      expect(ownerCreate.body.contact.email).toBe('jane.requester@example.com');
      expect(ownerCreate.body.contact.phone).toBeNull();
      expect(ownerCreate.body.contact.organizationId).toBe(
        String(organization._id)
      );
      expect(ownerCreate.body.contact.organization).toEqual({
        _id: String(organization._id),
        name: 'Acme Org',
        domain: 'acme.example'
      });
      expect(ownerCreate.body.contact.customFields).toEqual({
        source: 'Manual'
      });
      expectExactKeys(ownerCreate.body.contact, CONTACT_RESOURCE_KEYS);

      const adminCreate = await createContactRequest({
        accessToken: admin.accessToken,
        body: {
          fullName: 'Admin Phone Only',
          phone: '  00963 955 000 111  '
        }
      });

      expect(adminCreate.status).toBe(200);
      expect(adminCreate.body.contact.email).toBeNull();
      expect(adminCreate.body.contact.phone).toBe('+963955000111');
      expect(adminCreate.body.contact.organizationId).toBeNull();
      expect(adminCreate.body.contact.organization).toBeNull();

      const agentCreate = await createContactRequest({
        accessToken: agent.accessToken,
        body: {
          fullName: 'Agent Both',
          email: 'agent.both@example.com',
          phone: '+963955000222'
        }
      });

      expect(agentCreate.status).toBe(200);
      expect(agentCreate.body.contact.email).toBe('agent.both@example.com');
      expect(agentCreate.body.contact.phone).toBe('+963955000222');

      const ownerNeither = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Manual Walk-in'
        }
      });

      expect(ownerNeither.status).toBe(200);
      expect(ownerNeither.body.contact.email).toBeNull();
      expect(ownerNeither.body.contact.phone).toBeNull();

      const viewerList = await request(app)
        .get('/api/customers/contacts')
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(viewerList.status).toBe(200);
      expect(viewerList.body.contacts.length).toBeGreaterThanOrEqual(4);

      const viewerCreate = await createContactRequest({
        accessToken: viewer.accessToken,
        body: {
          fullName: 'Viewer Contact'
        }
      });

      expect(viewerCreate.status).toBe(403);
      expect(viewerCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

      const viewerUpdate = await request(app)
        .patch(`/api/customers/contacts/${ownerCreate.body.contact._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ phone: '+963955000333' });

      expect(viewerUpdate.status).toBe(403);
      expect(viewerUpdate.body.messageKey).toBe('errors.auth.forbiddenRole');
    }
  );

  maybeDbTest(
    'list and options endpoints support pagination, search, filters, sort, and workspace isolation',
    async () => {
      const ownerA = await createVerifiedUser({
        email: nextEmail('contacts-list-a')
      });
      const ownerB = await createVerifiedUser({
        email: nextEmail('contacts-list-b')
      });
      const organization = await createOrganizationRecord({
        workspaceId: ownerA.workspaceId,
        name: 'Acme Customers',
        domain: 'acme.example'
      });

      const alpha = await Contact.create({
        workspaceId: ownerA.workspaceId,
        organizationId: organization._id,
        fullName: 'Acme Alpha',
        email: 'alpha@example.com',
        phone: '+963955111111',
        tags: ['VIP']
      });
      const beta = await Contact.create({
        workspaceId: ownerA.workspaceId,
        fullName: 'Beta Contact',
        email: 'beta@example.com'
      });
      const gamma = await Contact.create({
        workspaceId: ownerA.workspaceId,
        organizationId: organization._id,
        fullName: 'Acme Gamma',
        email: 'gamma@example.com'
      });
      await Contact.create({
        workspaceId: ownerA.workspaceId,
        fullName: 'Acme Deleted',
        email: 'deleted@example.com',
        deletedAt: new Date('2026-03-20T00:00:00.000Z')
      });
      const foreign = await Contact.create({
        workspaceId: ownerB.workspaceId,
        fullName: 'Workspace B Contact',
        email: 'foreign@example.com'
      });

      const searchList = await request(app)
        .get('/api/customers/contacts?q=acme')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(searchList.status).toBe(200);
      expect(searchList.body.contacts).toHaveLength(2);
      for (const contact of searchList.body.contacts) {
        expectExactKeys(contact, CONTACT_LIST_KEYS);
      }

      const organizationFilter = await request(app)
        .get(`/api/customers/contacts?organizationId=${organization._id}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(organizationFilter.status).toBe(200);
      expect(organizationFilter.body.contacts).toHaveLength(2);
      expect(
        organizationFilter.body.contacts.every(
          (contact) => contact.organizationId === String(organization._id)
        )
      ).toBe(true);

      const emailFilter = await request(app)
        .get('/api/customers/contacts?email=alpha@example.com')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(emailFilter.status).toBe(200);
      expect(emailFilter.body.contacts).toHaveLength(1);
      expect(emailFilter.body.contacts[0]._id).toBe(String(alpha._id));

      const pagedList = await request(app)
        .get('/api/customers/contacts?page=1&limit=1&sort=fullName')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(pagedList.status).toBe(200);
      expect(pagedList.body.page).toBe(1);
      expect(pagedList.body.limit).toBe(1);
      expect(pagedList.body.results).toBe(1);
      expect(pagedList.body.total).toBe(3);

      const options = await request(app)
        .get('/api/customers/contacts/options?search=acme')
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(options.status).toBe(200);
      expect(options.body.options).toHaveLength(2);
      for (const option of options.body.options) {
        expectExactKeys(option, CONTACT_OPTION_KEYS);
      }

      const ownerBList = await request(app)
        .get('/api/customers/contacts')
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(ownerBList.status).toBe(200);

      const ownerBIds = new Set(
        ownerBList.body.contacts.map((contact) => contact._id)
      );
      expect(ownerBIds.has(String(foreign._id))).toBe(true);
      expect(ownerBIds.has(String(alpha._id))).toBe(false);
      expect(ownerBIds.has(String(gamma._id))).toBe(false);
      expect(ownerBIds.has(String(beta._id))).toBe(false);
    }
  );

  maybeDbTest(
    'viewer can read contact details and agent can update allowed fields including organization linkage',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('contacts-read-update-owner')
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER
      });
      const firstOrganization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
        name: 'First Org',
        domain: 'first.example'
      });
      const secondOrganization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
        name: 'Second Org',
        domain: 'second.example'
      });

      const created = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Detail Contact',
          organizationId: String(firstOrganization._id),
          email: 'detail.contact@example.com',
          phone: '+963955777777',
          tags: ['VIP', 'Priority'],
          customFields: {
            region: 'EMEA'
          }
        }
      });
      expect(created.status).toBe(200);

      const detail = await request(app)
        .get(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.contact.organization).toEqual({
        _id: String(firstOrganization._id),
        name: 'First Org',
        domain: 'first.example'
      });
      expectExactKeys(detail.body.contact, CONTACT_RESOURCE_KEYS);

      const updated = await request(app)
        .patch(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`)
        .send({
          fullName: 'Updated Contact',
          organizationId: String(secondOrganization._id),
          email: 'UPDATED.CONTACT@EXAMPLE.COM',
          phone: null,
          tags: ['Priority', 'Escalated'],
          customFields: {
            region: '  APAC  '
          }
        });

      expect(updated.status).toBe(200);
      expect(updated.body.messageKey).toBe('success.contact.updated');
      expect(updated.body.contact.fullName).toBe('Updated Contact');
      expect(updated.body.contact.email).toBe('updated.contact@example.com');
      expect(updated.body.contact.phone).toBeNull();
      expect(updated.body.contact.tags).toEqual(['Priority', 'Escalated']);
      expect(updated.body.contact.customFields).toEqual({
        region: 'APAC'
      });
      expect(updated.body.contact.organization).toEqual({
        _id: String(secondOrganization._id),
        name: 'Second Org',
        domain: 'second.example'
      });
      expectExactKeys(updated.body.contact, CONTACT_RESOURCE_KEYS);

      const detailAfterUpdate = await request(app)
        .get(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`);
      expect(detailAfterUpdate.status).toBe(200);
      expect(detailAfterUpdate.body.contact.organizationId).toBe(
        String(secondOrganization._id)
      );
      expect(detailAfterUpdate.body.contact.organization.name).toBe(
        'Second Org'
      );
      expectExactKeys(detailAfterUpdate.body.contact, CONTACT_RESOURCE_KEYS);
    }
  );

  maybeDbTest(
    'validation failures and invalid membership access use the standard envelope',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('contacts-validation-owner')
      });

      const unknownFieldCreate = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Invalid Contact',
          unknownField: 'not-allowed'
        }
      });
      expectValidationError(
        unknownFieldCreate,
        'unknownField',
        'errors.validation.unknownField'
      );

      const invalidOrganizationCreate = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Invalid Org Contact',
          organizationId: 'not-an-id'
        }
      });
      expectValidationError(
        invalidOrganizationCreate,
        'organizationId',
        'errors.validation.invalidId'
      );

      const invalidEmailCreate = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Invalid Email Contact',
          email: 'not-an-email'
        }
      });
      expectValidationError(
        invalidEmailCreate,
        'email',
        'errors.validation.invalidEmail'
      );

      const invalidPhoneCreate = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Invalid Phone Contact',
          phone: 'not-a-phone'
        }
      });
      expectValidationError(
        invalidPhoneCreate,
        'phone',
        'errors.validation.invalidPhone'
      );

      const invalidListQuery = await request(app)
        .get(
          '/api/customers/contacts?limit=101&sort=bad&email=not-an-email&organizationId=bad'
        )
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
            field: 'email',
            messageKey: 'errors.validation.invalidEmail'
          }),
          expect.objectContaining({
            field: 'organizationId',
            messageKey: 'errors.validation.invalidId'
          })
        ])
      );

      const invalidId = await request(app)
        .get('/api/customers/contacts/not-an-id')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(invalidId, 'id', 'errors.validation.invalidId');

      const created = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Patch Target'
        }
      });
      expect(created.status).toBe(200);

      const emptyPatch = await request(app)
        .patch(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expectValidationError(
        emptyPatch,
        'body',
        'errors.validation.bodyRequiresAtLeastOneField'
      );

      const invalidPhonePatch = await request(app)
        .patch(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          phone: 'still-not-a-phone'
        });
      expectValidationError(
        invalidPhonePatch,
        'phone',
        'errors.validation.invalidPhone'
      );

      await WorkspaceMember.deleteOne({
        workspaceId: owner.workspaceId,
        userId: new mongoose.Types.ObjectId(owner.userId)
      });

      const forbiddenTenant = await request(app)
        .get('/api/customers/contacts')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(forbiddenTenant.status).toBe(403);
      expect(forbiddenTenant.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );
    }
  );

  maybeDbTest(
    'cross-workspace and nonexistent contacts resolve as not found and foreign organizations are rejected',
    async () => {
      const ownerA = await createVerifiedUser({
        email: nextEmail('contacts-isolation-a')
      });
      const ownerB = await createVerifiedUser({
        email: nextEmail('contacts-isolation-b')
      });
      const organizationA = await createOrganizationRecord({
        workspaceId: ownerA.workspaceId,
        name: 'Workspace A Org',
        domain: 'workspace-a.example'
      });
      const organizationB = await createOrganizationRecord({
        workspaceId: ownerB.workspaceId,
        name: 'Workspace B Org',
        domain: 'workspace-b.example'
      });

      const created = await createContactRequest({
        accessToken: ownerA.accessToken,
        body: {
          fullName: 'Workspace A Contact',
          organizationId: String(organizationA._id)
        }
      });
      expect(created.status).toBe(200);

      const ownerBGet = await request(app)
        .get(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(ownerBGet.status).toBe(404);
      expect(ownerBGet.body.messageKey).toBe('errors.contact.notFound');

      const ownerBPatch = await request(app)
        .patch(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({ phone: '+963955123123' });
      expect(ownerBPatch.status).toBe(404);
      expect(ownerBPatch.body.messageKey).toBe('errors.contact.notFound');

      const crossWorkspaceOrganizationCreate = await createContactRequest({
        accessToken: ownerA.accessToken,
        body: {
          fullName: 'Wrong Org Contact',
          organizationId: String(organizationB._id)
        }
      });
      expect(crossWorkspaceOrganizationCreate.status).toBe(404);
      expect(crossWorkspaceOrganizationCreate.body.messageKey).toBe(
        'errors.organization.notFound'
      );

      const crossWorkspaceOrganizationPatch = await request(app)
        .patch(`/api/customers/contacts/${created.body.contact._id}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          organizationId: String(organizationB._id)
        });
      expect(crossWorkspaceOrganizationPatch.status).toBe(404);
      expect(crossWorkspaceOrganizationPatch.body.messageKey).toBe(
        'errors.organization.notFound'
      );

      const nonexistentGet = await request(app)
        .get(`/api/customers/contacts/${new mongoose.Types.ObjectId()}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`);
      expect(nonexistentGet.status).toBe(404);
      expect(nonexistentGet.body.messageKey).toBe('errors.contact.notFound');
    }
  );

  maybeDbTest(
    'customers and tickets stay aligned for contact-linked ticket creation, filters, and lean customer summaries',
    async () => {
      const owner = await createVerifiedUser({
        email: nextEmail('contacts-ticket-owner')
      });

      const createdOrganization = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Ticket Customer Org',
          domain: 'ticket-customer.example'
        }
      });
      expect(createdOrganization.status).toBe(200);

      const createdContact = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Ticket Requester',
          organizationId: createdOrganization.body.organization._id,
          email: 'requester@example.com'
        }
      });
      expect(createdContact.status).toBe(200);

      const secondOrganization = await createOrganizationRequest({
        accessToken: owner.accessToken,
        body: {
          name: 'Second Ticket Org',
          domain: 'second-ticket.example'
        }
      });
      expect(secondOrganization.status).toBe(200);

      const secondContact = await createContactRequest({
        accessToken: owner.accessToken,
        body: {
          fullName: 'Second Ticket Requester',
          organizationId: secondOrganization.body.organization._id,
          email: 'second.requester@example.com',
          phone: '+963955111222',
          tags: ['VIP'],
          customFields: {
            region: 'EMEA'
          }
        }
      });
      expect(secondContact.status).toBe(200);

      const ticketCreate = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Ticket created from API contact',
          contactId: createdContact.body.contact._id
        }
      });
      const secondTicket = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Second customer ticket',
          contactId: secondContact.body.contact._id
        }
      });

      expect(ticketCreate.status).toBe(200);
      expect(secondTicket.status).toBe(200);
      expect(ticketCreate.body.ticket.contactId).toBe(
        createdContact.body.contact._id
      );
      expect(ticketCreate.body.ticket.organizationId).toBe(
        createdOrganization.body.organization._id
      );

      const listByContact = await request(app)
        .get(`/api/tickets?contactId=${createdContact.body.contact._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(listByContact.status).toBe(200);
      expect(listByContact.body.tickets).toHaveLength(1);
      expect(listByContact.body.tickets[0]._id).toBe(ticketCreate.body.ticket._id);
      expectExactKeys(listByContact.body.tickets[0].contact, TICKET_CONTACT_SUMMARY_KEYS);
      expectExactKeys(
        listByContact.body.tickets[0].organization,
        TICKET_ORGANIZATION_SUMMARY_KEYS
      );

      const listByOrganization = await request(app)
        .get(
          `/api/tickets?organizationId=${createdOrganization.body.organization._id}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(listByOrganization.status).toBe(200);
      expect(listByOrganization.body.tickets).toHaveLength(1);
      expect(listByOrganization.body.tickets[0]._id).toBe(
        ticketCreate.body.ticket._id
      );
      expect(listByOrganization.body.tickets[0]._id).not.toBe(
        secondTicket.body.ticket._id
      );

      const ticketDetail = await request(app)
        .get(`/api/tickets/${ticketCreate.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(ticketDetail.status).toBe(200);
      expectExactKeys(ticketDetail.body.ticket.contact, TICKET_CONTACT_SUMMARY_KEYS);
      expectExactKeys(
        ticketDetail.body.ticket.organization,
        TICKET_ORGANIZATION_SUMMARY_KEYS
      );
      expect(ticketDetail.body.ticket.contact).toEqual(
        expect.objectContaining({
          _id: createdContact.body.contact._id,
          fullName: 'Ticket Requester',
          organizationId: createdOrganization.body.organization._id,
          email: 'requester@example.com',
          phone: null
        })
      );
      expect(ticketDetail.body.ticket.organization).toEqual({
        _id: createdOrganization.body.organization._id,
        name: 'Ticket Customer Org',
        domain: 'ticket-customer.example'
      });
      expect(ticketDetail.body.ticket.contact).not.toHaveProperty('workspaceId');
      expect(ticketDetail.body.ticket.contact).not.toHaveProperty('tags');
      expect(ticketDetail.body.ticket.contact).not.toHaveProperty('customFields');
      expect(ticketDetail.body.ticket.contact).not.toHaveProperty('organization');
      expect(ticketDetail.body.ticket.organization).not.toHaveProperty('workspaceId');
      expect(ticketDetail.body.ticket.organization).not.toHaveProperty('notes');
    }
  );
});
