import request from 'supertest';
import app from '../src/app.js';
import { t } from '../src/i18n/index.js';
import { TICKET_MESSAGE_TYPE } from '../src/constants/ticket-message-type.js';
import { TICKET_PRIORITY } from '../src/constants/ticket-priority.js';
import { TICKET_STATUS } from '../src/constants/ticket-status.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { Organization } from '../src/modules/customers/models/organization.model.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { Conversation } from '../src/modules/tickets/models/conversation.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { TicketCounter } from '../src/modules/tickets/models/ticket-counter.model.js';

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
  email = nextEmail('ticket-owner'),
  password = 'Password123!',
  name = 'Test User',
} = {}) => {
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

const createWorkspaceScopedTokenForRole = async ({ owner, roleKey }) => {
  const member = await createVerifiedUser({
    email: nextEmail(`ticket-${roleKey}`),
  });

  const invite = await createInviteWithToken({
    workspaceId: owner.workspaceId,
    accessToken: owner.accessToken,
    email: member.email,
    roleKey,
  });

  expect(invite.response.status).toBe(200);
  expect(invite.token).toBeTruthy();

  const accept = await request(app)
    .post('/api/workspaces/invites/accept')
    .send({
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
    userId: member.userId,
  };
};

const getDefaultMailbox = async (workspaceId) => {
  const workspace = await Workspace.findOne({
    _id: workspaceId,
    deletedAt: null,
  })
    .select('_id defaultMailboxId')
    .lean();

  expect(workspace?.defaultMailboxId).toBeTruthy();

  return Mailbox.findOne({
    _id: workspace.defaultMailboxId,
    workspaceId,
    deletedAt: null,
  }).lean();
};

const createMailboxRecord = async ({
  workspaceId,
  name = nextValue('Mailbox'),
  isActive = true,
}) =>
  Mailbox.create({
    workspaceId,
    name,
    isActive,
    isDefault: false,
  });

const createOrganizationRecord = async ({
  workspaceId,
  name = nextValue('Organization'),
}) =>
  Organization.create({
    workspaceId,
    name,
    domain: `${nextValue('org')}.example.com`,
  });

const createContactRecord = async ({
  workspaceId,
  organizationId = null,
  fullName = nextValue('Contact'),
}) =>
  Contact.create({
    workspaceId,
    organizationId,
    fullName,
    email: nextEmail('contact'),
    phone: '+963955555555',
  });

const createCategory = async ({ accessToken, name = nextValue('Category') }) =>
  request(app)
    .post('/api/tickets/categories')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name });

const createTag = async ({ accessToken, name = nextValue('Tag') }) =>
  request(app)
    .post('/api/tickets/tags')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name });

const createTicketRequest = async ({ accessToken, body }) =>
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
        messageKey,
      }),
    ])
  );
};

describe('Core tickets endpoints', () => {
  maybeDbTest(
    'creates tickets with default mailbox, derived organization, initial internal note, and counter-backed numbers',
    async () => {
      const owner = await createVerifiedUser();
      const defaultMailbox = await getDefaultMailbox(owner.workspaceId);
      const organization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
        organizationId: organization._id,
      });

      const firstResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Billing issue on paid plan',
          contactId: String(contact._id),
          initialMessage: {
            type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
            bodyText: 'Internal triage note',
          },
        },
      });

      expect(firstResponse.status).toBe(200);
      expect(firstResponse.body.messageKey).toBe('success.ticket.created');
      expect(firstResponse.body.ticket.number).toBe(1);
      expect(firstResponse.body.ticket.mailboxId).toBe(
        String(defaultMailbox._id)
      );
      expect(firstResponse.body.ticket.organizationId).toBe(
        String(organization._id)
      );
      expect(firstResponse.body.ticket.messageCount).toBe(1);
      expect(firstResponse.body.ticket.internalNoteCount).toBe(1);
      expect(firstResponse.body.ticket.lastMessageType).toBe(
        TICKET_MESSAGE_TYPE.INTERNAL_NOTE
      );
      expect(firstResponse.body.ticket.lastInternalNoteAt).toBeTruthy();
      expect(firstResponse.body.ticket.lastMessagePreview).toBe(
        'Internal triage note'
      );
      expect(firstResponse.body.ticket.conversationId).toBeTruthy();
      expect(firstResponse.body.ticket.conversation).toEqual(
        expect.objectContaining({
          _id: firstResponse.body.ticket.conversationId,
          messageCount: 1,
          internalNoteCount: 1,
          lastMessageType: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
        })
      );

      const createdTicket = await Ticket.findById(
        firstResponse.body.ticket._id
      ).lean();
      expect(createdTicket?.conversationId).toBeTruthy();
      expect(createdTicket?.messageCount).toBe(1);
      expect(createdTicket?.internalNoteCount).toBe(1);

      const conversationCount = await Conversation.countDocuments({
        workspaceId: owner.workspaceId,
        ticketId: firstResponse.body.ticket._id,
        deletedAt: null,
      });
      expect(conversationCount).toBe(1);

      const secondResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Second ticket number check',
          contactId: String(contact._id),
        },
      });

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.ticket.number).toBe(2);
    }
  );

  maybeDbTest(
    'creates tickets with explicit mailbox/category/tag refs and detail still renders linked inactive refs',
    async () => {
      const owner = await createVerifiedUser();
      const mailbox = await createMailboxRecord({
        workspaceId: owner.workspaceId,
      });
      const organization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
        organizationId: organization._id,
      });
      const category = await createCategory({ accessToken: owner.accessToken });
      const tag = await createTag({ accessToken: owner.accessToken });

      expect(category.status).toBe(200);
      expect(tag.status).toBe(200);

      const createResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Enterprise onboarding issue',
          mailboxId: String(mailbox._id),
          contactId: String(contact._id),
          organizationId: String(organization._id),
          categoryId: category.body.category._id,
          tagIds: [tag.body.tag._id],
        },
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.ticket.mailboxId).toBe(String(mailbox._id));
      expect(createResponse.body.ticket.category._id).toBe(
        category.body.category._id
      );
      expect(createResponse.body.ticket.tags[0]._id).toBe(tag.body.tag._id);

      const deactivateCategory = await request(app)
        .post(
          `/api/tickets/categories/${category.body.category._id}/deactivate`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivateCategory.status).toBe(200);

      const deactivateTag = await request(app)
        .post(`/api/tickets/tags/${tag.body.tag._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivateTag.status).toBe(200);

      const detail = await request(app)
        .get(`/api/tickets/${createResponse.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body.ticket._id).toBe(createResponse.body.ticket._id);
      expect(detail.body.ticket.organization._id).toBe(
        String(organization._id)
      );
      expect(detail.body.ticket.category).toEqual(
        expect.objectContaining({
          _id: category.body.category._id,
          isActive: false,
        })
      );
      expect(detail.body.ticket.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: tag.body.tag._id,
            isActive: false,
          }),
        ])
      );
    }
  );

  maybeDbTest(
    'lists tickets with default closed exclusion, filters, and search by subject or number',
    async () => {
      const owner = await createVerifiedUser();
      const defaultMailbox = await getDefaultMailbox(owner.workspaceId);
      const alternateMailbox = await createMailboxRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const category = await createCategory({ accessToken: owner.accessToken });
      const tag = await createTag({ accessToken: owner.accessToken });

      expect(category.status).toBe(200);
      expect(tag.status).toBe(200);

      const first = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Alpha billing ticket',
          contactId: String(contact._id),
          categoryId: category.body.category._id,
          tagIds: [tag.body.tag._id],
          priority: TICKET_PRIORITY.HIGH,
        },
      });
      expect(first.status).toBe(200);

      const second = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Beta mailbox ticket',
          mailboxId: String(alternateMailbox._id),
          contactId: String(contact._id),
        },
      });
      expect(second.status).toBe(200);

      const closedNumber = await TicketCounter.allocateNextNumber(
        owner.workspaceId
      );
      await Ticket.create({
        workspaceId: owner.workspaceId,
        mailboxId: defaultMailbox._id,
        number: closedNumber,
        subject: 'Closed historical ticket',
        status: TICKET_STATUS.CLOSED,
        contactId: contact._id,
      });

      const defaultList = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(defaultList.status).toBe(200);
      expect(defaultList.body.tickets).toHaveLength(2);
      expect(
        defaultList.body.tickets.some(
          (ticket) => ticket.status === TICKET_STATUS.CLOSED
        )
      ).toBe(false);

      const includeClosed = await request(app)
        .get('/api/tickets?includeClosed=true')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(includeClosed.status).toBe(200);
      expect(
        includeClosed.body.tickets.some(
          (ticket) => ticket.status === TICKET_STATUS.CLOSED
        )
      ).toBe(true);

      const filtered = await request(app)
        .get(
          `/api/tickets?mailboxId=${alternateMailbox._id}&unassigned=true&sort=number`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(filtered.status).toBe(200);
      expect(filtered.body.tickets).toHaveLength(1);
      expect(filtered.body.tickets[0]._id).toBe(second.body.ticket._id);

      const byCategoryAndTag = await request(app)
        .get(
          `/api/tickets?categoryId=${category.body.category._id}&tagId=${tag.body.tag._id}&priority=${TICKET_PRIORITY.HIGH}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(byCategoryAndTag.status).toBe(200);
      expect(byCategoryAndTag.body.tickets).toHaveLength(1);
      expect(byCategoryAndTag.body.tickets[0]._id).toBe(first.body.ticket._id);

      const bySubject = await request(app)
        .get('/api/tickets?q=alpha%20billing')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(bySubject.status).toBe(200);
      expect(bySubject.body.tickets).toHaveLength(1);
      expect(bySubject.body.tickets[0]._id).toBe(first.body.ticket._id);

      const byNumber = await request(app)
        .get(`/api/tickets?q=${second.body.ticket.number}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(byNumber.status).toBe(200);
      expect(byNumber.body.tickets).toHaveLength(1);
      expect(byNumber.body.tickets[0]._id).toBe(second.body.ticket._id);

      await Ticket.updateOne(
        {
          _id: first.body.ticket._id,
          workspaceId: owner.workspaceId,
          deletedAt: null,
        },
        {
          $set: {
            status: TICKET_STATUS.PENDING,
          },
        }
      );

      const multiStatusComma = await request(app)
        .get(
          `/api/tickets?status=${TICKET_STATUS.PENDING},${TICKET_STATUS.CLOSED}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(multiStatusComma.status).toBe(200);
      expect(multiStatusComma.body.tickets).toHaveLength(2);
      expect(multiStatusComma.body.tickets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: first.body.ticket._id,
            status: TICKET_STATUS.PENDING,
          }),
          expect.objectContaining({
            status: TICKET_STATUS.CLOSED,
          }),
        ])
      );

      const multiStatusRepeated = await request(app)
        .get(
          `/api/tickets?status=${TICKET_STATUS.NEW}&status=${TICKET_STATUS.PENDING}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(multiStatusRepeated.status).toBe(200);
      expect(multiStatusRepeated.body.tickets).toHaveLength(2);
      expect(
        multiStatusRepeated.body.tickets.some(
          (ticket) => ticket.status === TICKET_STATUS.CLOSED
        )
      ).toBe(false);
    }
  );

  maybeDbTest(
    'patches editable fields and allows mailbox change only before messages exist',
    async () => {
      const owner = await createVerifiedUser();
      const firstMailbox = await getDefaultMailbox(owner.workspaceId);
      const secondMailbox = await createMailboxRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const firstCategory = await createCategory({
        accessToken: owner.accessToken,
      });
      const secondCategory = await createCategory({
        accessToken: owner.accessToken,
      });
      const firstTag = await createTag({ accessToken: owner.accessToken });
      const secondTag = await createTag({ accessToken: owner.accessToken });

      const createResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Patch me',
          contactId: String(contact._id),
          categoryId: firstCategory.body.category._id,
          tagIds: [firstTag.body.tag._id],
        },
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.ticket.mailboxId).toBe(
        String(firstMailbox._id)
      );

      const updateResponse = await request(app)
        .patch(`/api/tickets/${createResponse.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          subject: 'Patched subject',
          priority: TICKET_PRIORITY.URGENT,
          categoryId: secondCategory.body.category._id,
          tagIds: [secondTag.body.tag._id],
          mailboxId: String(secondMailbox._id),
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.messageKey).toBe('success.ticket.updated');
      expect(updateResponse.body.ticket.subject).toBe('Patched subject');
      expect(updateResponse.body.ticket.priority).toBe(TICKET_PRIORITY.URGENT);
      expect(updateResponse.body.ticket.mailboxId).toBe(
        String(secondMailbox._id)
      );
      expect(updateResponse.body.ticket.category._id).toBe(
        secondCategory.body.category._id
      );
      expect(updateResponse.body.ticket.tags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: secondTag.body.tag._id,
          }),
        ])
      );
      expect(updateResponse.body.ticket.conversation.mailboxId).toBe(
        String(secondMailbox._id)
      );

      const [updatedTicket, updatedConversation] = await Promise.all([
        Ticket.findById(createResponse.body.ticket._id).lean(),
        Conversation.findById(createResponse.body.ticket.conversationId).lean(),
      ]);

      expect(String(updatedTicket.mailboxId)).toBe(String(secondMailbox._id));
      expect(String(updatedConversation.mailboxId)).toBe(
        String(secondMailbox._id)
      );
    }
  );

  maybeDbTest(
    'enforces create and update RBAC, anti-enumeration, write-time reference validation, and patch validation rules',
    async () => {
      const owner = await createVerifiedUser();
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const otherOwner = await createVerifiedUser();
      const organization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
      });
      const otherOrganization = await createOrganizationRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
        organizationId: organization._id,
      });
      const otherWorkspaceContact = await createContactRecord({
        workspaceId: otherOwner.workspaceId,
      });
      const inactiveMailbox = await createMailboxRecord({
        workspaceId: owner.workspaceId,
        isActive: false,
      });
      const inactiveCategory = await createCategory({
        accessToken: owner.accessToken,
      });
      const inactiveTag = await createTag({
        accessToken: owner.accessToken,
      });

      await request(app)
        .post(
          `/api/tickets/categories/${inactiveCategory.body.category._id}/deactivate`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      await request(app)
        .post(`/api/tickets/tags/${inactiveTag.body.tag._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      const viewerCreate = await createTicketRequest({
        accessToken: viewer.accessToken,
        body: {
          subject: 'Viewer cannot create',
          contactId: String(contact._id),
        },
      });
      expect(viewerCreate.status).toBe(403);
      expect(viewerCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Owner ticket',
          contactId: String(contact._id),
        },
      });
      expect(created.status).toBe(200);

      const viewerPatch = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ subject: 'Nope' });
      expect(viewerPatch.status).toBe(403);
      expect(viewerPatch.body.messageKey).toBe('errors.auth.forbiddenRole');

      const invalidId = await request(app)
        .get('/api/tickets/not-a-valid-id')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(invalidId, 'id', 'errors.validation.invalidId');

      const foreignCreate = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Cross workspace contact',
          contactId: String(otherWorkspaceContact._id),
        },
      });
      expect(foreignCreate.status).toBe(404);
      expect(foreignCreate.body.messageKey).toBe(
        'errors.ticket.contactNotFound'
      );

      const foreignTicket = await Ticket.create({
        workspaceId: otherOwner.workspaceId,
        mailboxId: (await getDefaultMailbox(otherOwner.workspaceId))._id,
        number: await TicketCounter.allocateNextNumber(otherOwner.workspaceId),
        subject: 'Other workspace ticket',
        contactId: otherWorkspaceContact._id,
      });

      const foreignDetail = await request(app)
        .get(`/api/tickets/${foreignTicket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(foreignDetail.status).toBe(404);
      expect(foreignDetail.body.messageKey).toBe('errors.ticket.notFound');

      const inactiveMailboxCreate = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Inactive mailbox',
          mailboxId: String(inactiveMailbox._id),
          contactId: String(contact._id),
        },
      });
      expect(inactiveMailboxCreate.status).toBe(404);
      expect(inactiveMailboxCreate.body.messageKey).toBe(
        'errors.mailbox.notFound'
      );

      const inactiveCategoryCreate = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Inactive category',
          contactId: String(contact._id),
          categoryId: inactiveCategory.body.category._id,
        },
      });
      expect(inactiveCategoryCreate.status).toBe(404);
      expect(inactiveCategoryCreate.body.messageKey).toBe(
        'errors.ticketCategory.notFound'
      );

      const inactiveTagPatch = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          tagIds: [inactiveTag.body.tag._id],
        });
      expect(inactiveTagPatch.status).toBe(404);
      expect(inactiveTagPatch.body.messageKey).toBe(
        'errors.ticketTag.notFound'
      );

      const duplicateTags = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Duplicate tags',
          contactId: String(contact._id),
          tagIds: [inactiveTag.body.tag._id, inactiveTag.body.tag._id],
        },
      });
      expectValidationError(
        duplicateTags,
        'tagIds',
        'errors.validation.duplicateValues'
      );

      const mismatchOrganization = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Mismatched organization',
          contactId: String(contact._id),
          organizationId: String(otherOrganization._id),
        },
      });
      expectValidationError(
        mismatchOrganization,
        'organizationId',
        'errors.ticket.organizationMismatch'
      );

      const invalidAssignee = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Invalid assignee',
          contactId: String(contact._id),
          assigneeId: viewer.userId,
        },
      });
      expect(invalidAssignee.status).toBe(404);
      expect(invalidAssignee.body.messageKey).toBe(
        'errors.ticket.assigneeNotFound'
      );

      const invalidInitialType = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Bad initial type',
          contactId: String(contact._id),
          initialMessage: {
            type: 'public_reply',
            bodyText: 'not allowed here',
          },
        },
      });
      expectValidationError(
        invalidInitialType,
        'initialMessage.type',
        'errors.validation.invalidEnum'
      );

      const unknownCreateField = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Unknown create field',
          contactId: String(contact._id),
          status: TICKET_STATUS.CLOSED,
        },
      });
      expectValidationError(
        unknownCreateField,
        'status',
        'errors.validation.unknownField'
      );

      const unknownInitialMessageField = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Unknown initial message field',
          contactId: String(contact._id),
          initialMessage: {
            type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
            bodyText: 'valid body',
            direction: 'inbound',
          },
        },
      });
      expectValidationError(
        unknownInitialMessageField,
        'initialMessage.direction',
        'errors.validation.unknownField'
      );

      const duplicateInitialAttachments = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Duplicate initial attachments',
          contactId: String(contact._id),
          initialMessage: {
            type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
            bodyText: 'text',
            attachmentFileIds: [
              '507f1f77bcf86cd799439011',
              '507f1f77bcf86cd799439011',
            ],
          },
        },
      });
      expectValidationError(
        duplicateInitialAttachments,
        'initialMessage.attachmentFileIds',
        'errors.validation.duplicateValues'
      );

      const unknownFieldPatch = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          subject: 'Rename',
          status: TICKET_STATUS.CLOSED,
        });
      expectValidationError(
        unknownFieldPatch,
        'status',
        'errors.validation.unknownField'
      );

      const emptyPatch = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expectValidationError(
        emptyPatch,
        'body',
        'errors.validation.bodyRequiresAtLeastOneField'
      );

      const invalidCreatedRange = await request(app)
        .get(
          '/api/tickets?createdFrom=2026-03-14T00:00:00.000Z&createdTo=2026-03-13T00:00:00.000Z'
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(
        invalidCreatedRange,
        'createdFrom',
        'errors.validation.invalidDateRange'
      );

      const invalidUpdatedRange = await request(app)
        .get(
          '/api/tickets?updatedFrom=2026-03-14T00:00:00.000Z&updatedTo=2026-03-13T00:00:00.000Z'
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(
        invalidUpdatedRange,
        'updatedFrom',
        'errors.validation.invalidDateRange'
      );
    }
  );

  maybeDbTest(
    'rejects mailbox changes after the ticket already has messages',
    async () => {
      const owner = await createVerifiedUser();
      const mailbox = await createMailboxRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Message-bearing ticket',
          contactId: String(contact._id),
          initialMessage: {
            type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
            bodyText: 'Customer says hello',
          },
        },
      });

      expect(created.status).toBe(200);
      expect(created.body.ticket.status).toBe(TICKET_STATUS.OPEN);
      expect(created.body.ticket.messageCount).toBe(1);
      expect(created.body.ticket.lastCustomerMessageAt).toBeTruthy();

      const updateResponse = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          mailboxId: String(mailbox._id),
        });

      expect(updateResponse.status).toBe(409);
      expect(updateResponse.body.messageKey).toBe(
        'errors.ticket.mailboxChangeNotAllowed'
      );
      expect(updateResponse.body.message).toBe(
        t('errors.ticket.mailboxChangeNotAllowed', 'en', {
          messageCount: 1,
        })
      );
    }
  );

  maybeDbTest(
    'rejects mailbox changes when the conversation invariant is broken and keeps ticket mailbox unchanged',
    async () => {
      const owner = await createVerifiedUser();
      const secondMailbox = await createMailboxRecord({
        workspaceId: owner.workspaceId,
      });
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Conversation invariant guard',
          contactId: String(contact._id),
        },
      });

      expect(created.status).toBe(200);

      const ticketBefore = await Ticket.findById(created.body.ticket._id).lean();
      expect(ticketBefore?.conversationId).toBeTruthy();

      await Conversation.deleteOne({
        _id: ticketBefore.conversationId,
      });

      const updateResponse = await request(app)
        .patch(`/api/tickets/${created.body.ticket._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          mailboxId: String(secondMailbox._id),
        });

      expect(updateResponse.status).toBe(500);
      expect(updateResponse.body.messageKey).toBe(
        'errors.ticket.conversationInvariantFailed'
      );

      const ticketAfter = await Ticket.findById(created.body.ticket._id).lean();
      expect(String(ticketAfter.mailboxId)).toBe(String(ticketBefore.mailboxId));
    }
  );
});
