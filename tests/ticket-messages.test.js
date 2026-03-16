import request from 'supertest';
import { jest } from '@jest/globals';
import app from '../src/app.js';
import { t } from '../src/i18n/index.js';
import { FILE_LINK_ENTITY_TYPE } from '../src/constants/file-link-entity-type.js';
import { FILE_LINK_RELATION_TYPE } from '../src/constants/file-link-relation-type.js';
import { TICKET_MESSAGE_TYPE } from '../src/constants/ticket-message-type.js';
import { TICKET_STATUS } from '../src/constants/ticket-status.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { File } from '../src/modules/files/models/file.model.js';
import { FileLink } from '../src/modules/files/models/file-link.model.js';
import { Conversation } from '../src/modules/tickets/models/conversation.model.js';
import { Message } from '../src/modules/tickets/models/message.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';

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
  email = nextEmail('ticket-message-owner'),
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
    email: nextEmail(`ticket-message-${roleKey}`),
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

const createContactRecord = async ({
  workspaceId,
  fullName = nextValue('Message Contact'),
}) =>
  Contact.create({
    workspaceId,
    fullName,
    email: nextEmail('message-contact'),
    phone: '+963955555555',
  });

const uploadTextFile = (
  accessToken,
  filename = 'notes.txt',
  content = 'hello file'
) =>
  request(app)
    .post('/api/files')
    .set('Authorization', `Bearer ${accessToken}`)
    .attach('file', Buffer.from(content), {
      filename,
      contentType: 'text/plain',
    });

const createTicketRequest = async ({ accessToken, body }) =>
  request(app)
    .post('/api/tickets')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);

const createTicketMessageRequest = async ({ accessToken, ticketId, body }) =>
  request(app)
    .post(`/api/tickets/${ticketId}/messages`)
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

describe('Ticket conversation and message endpoints', () => {
  maybeDbTest(
    'supports initial message attachments on ticket create and writes message plus ticket file links',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const uploadA = await uploadTextFile(
        owner.accessToken,
        'ticket-init-a.txt'
      );
      const uploadB = await uploadTextFile(
        owner.accessToken,
        'ticket-init-b.txt'
      );

      expect(uploadA.status).toBe(200);
      expect(uploadB.status).toBe(200);

      const createResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Initial attachments supported',
          contactId: String(contact._id),
          initialMessage: {
            type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
            bodyText: 'Initial note with files',
            attachmentFileIds: [uploadA.body.file._id, uploadB.body.file._id],
          },
        },
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.ticket.messageCount).toBe(1);
      expect(createResponse.body.ticket.internalNoteCount).toBe(1);
      expect(createResponse.body.ticket.attachmentCount).toBe(2);
      expect(createResponse.body.ticket.lastMessagePreview).toBe(
        'Initial note with files'
      );
      expect(createResponse.body.ticket.conversation.attachmentCount).toBe(2);

      const createdMessage = await Message.findOne({
        workspaceId: owner.workspaceId,
        ticketId: createResponse.body.ticket._id,
        deletedAt: null,
      }).lean();

      expect(createdMessage).toBeTruthy();
      expect(createdMessage.type).toBe(TICKET_MESSAGE_TYPE.INTERNAL_NOTE);
      expect(createdMessage.attachmentFileIds.map(String)).toEqual([
        uploadA.body.file._id,
        uploadB.body.file._id,
      ]);

      const activeLinks = await FileLink.find({
        workspaceId: owner.workspaceId,
        fileId: {
          $in: [uploadA.body.file._id, uploadB.body.file._id],
        },
        deletedAt: null,
      }).lean();

      expect(activeLinks).toHaveLength(4);
      expect(
        activeLinks.filter(
          (link) =>
            link.entityType === FILE_LINK_ENTITY_TYPE.MESSAGE &&
            String(link.entityId) === String(createdMessage._id) &&
            link.relationType === FILE_LINK_RELATION_TYPE.ATTACHMENT
        )
      ).toHaveLength(2);
      expect(
        activeLinks.filter(
          (link) =>
            link.entityType === FILE_LINK_ENTITY_TYPE.TICKET &&
            String(link.entityId) === createResponse.body.ticket._id &&
            link.relationType === FILE_LINK_RELATION_TYPE.ATTACHMENT
        )
      ).toHaveLength(2);
    }
  );

  maybeDbTest(
    'reads conversation and message history with oldest-first ordering, filters, and attachment summaries',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const createResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Conversation thread read',
          contactId: String(contact._id),
        },
      });

      expect(createResponse.status).toBe(200);

      const upload = await uploadTextFile(
        owner.accessToken,
        'message-thread.txt'
      );
      expect(upload.status).toBe(200);

      const firstMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: createResponse.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'First internal note',
          attachmentFileIds: [upload.body.file._id],
        },
      });
      expect(firstMessage.status).toBe(200);

      const secondMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: createResponse.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          bodyText: 'Customer follow-up',
        },
      });
      expect(secondMessage.status).toBe(200);

      const conversationResponse = await request(app)
        .get(`/api/tickets/${createResponse.body.ticket._id}/conversation`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(conversationResponse.status).toBe(200);
      expect(conversationResponse.body.conversation).toEqual(
        expect.objectContaining({
          _id: createResponse.body.ticket.conversationId,
          ticketId: createResponse.body.ticket._id,
          messageCount: 2,
          internalNoteCount: 1,
          attachmentCount: 1,
          lastMessageType: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          lastMessagePreview: 'Customer follow-up',
        })
      );
      expect(conversationResponse.body.conversation.mailbox).toBeTruthy();

      const listResponse = await request(app)
        .get(`/api/tickets/${createResponse.body.ticket._id}/messages`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.messages).toHaveLength(2);
      expect(listResponse.body.messages[0]).toEqual(
        expect.objectContaining({
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'First internal note',
        })
      );
      expect(listResponse.body.messages[0].attachments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: upload.body.file._id,
            originalName: 'message-thread.txt',
          }),
        ])
      );
      expect(listResponse.body.messages[1]).toEqual(
        expect.objectContaining({
          type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          bodyText: 'Customer follow-up',
        })
      );

      const filteredResponse = await request(app)
        .get(
          `/api/tickets/${createResponse.body.ticket._id}/messages?type=internal_note`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(filteredResponse.status).toBe(200);
      expect(filteredResponse.body.messages).toHaveLength(1);
      expect(filteredResponse.body.messages[0].type).toBe(
        TICKET_MESSAGE_TYPE.INTERNAL_NOTE
      );
    }
  );

  maybeDbTest(
    'message writes update ticket status, first response tracking, and reopen solved tickets while internal notes leave status unchanged',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const createResponse = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Status side effects',
          contactId: String(contact._id),
        },
      });

      expect(createResponse.status).toBe(200);

      const publicReply = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: createResponse.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'Agent public reply',
        },
      });

      expect(publicReply.status).toBe(200);
      expect(publicReply.body.ticketSummary.status).toBe(
        TICKET_STATUS.WAITING_ON_CUSTOMER
      );
      expect(publicReply.body.ticketSummary.publicMessageCount).toBe(1);
      expect(publicReply.body.ticketSummary.sla.firstResponseAt).toBeTruthy();
      expect(publicReply.body.messageRecord.from).toEqual({
        name: createResponse.body.ticket.mailbox.name,
        email: createResponse.body.ticket.mailbox.emailAddress,
      });
      expect(publicReply.body.messageRecord.to).toEqual([
        {
          name: contact.fullName,
          email: contact.email,
        },
      ]);

      const solvedTicket = await Ticket.findById(
        createResponse.body.ticket._id
      );
      solvedTicket.status = TICKET_STATUS.SOLVED;
      solvedTicket.sla = {
        ...(solvedTicket.sla?.toObject?.() || solvedTicket.sla || {}),
        resolvedAt: new Date(),
      };
      await solvedTicket.save();

      const customerMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: createResponse.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          bodyText: 'Customer reopened the ticket',
        },
      });

      expect(customerMessage.status).toBe(200);
      expect(customerMessage.body.ticketSummary.status).toBe(
        TICKET_STATUS.OPEN
      );
      expect(
        customerMessage.body.ticketSummary.lastCustomerMessageAt
      ).toBeTruthy();
      expect(customerMessage.body.ticketSummary.sla.resolvedAt).toBeNull();
      expect(customerMessage.body.messageRecord.from).toEqual({
        name: contact.fullName,
        email: contact.email,
      });
      expect(customerMessage.body.messageRecord.to).toEqual([
        {
          name: createResponse.body.ticket.mailbox.name,
          email: createResponse.body.ticket.mailbox.emailAddress,
        },
      ]);

      const pendingTicket = await Ticket.findById(
        createResponse.body.ticket._id
      );
      pendingTicket.status = TICKET_STATUS.PENDING;
      await pendingTicket.save();

      const internalNote = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: createResponse.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'Internal note keeps status',
        },
      });

      expect(internalNote.status).toBe(200);
      expect(internalNote.body.ticketSummary.status).toBe(
        TICKET_STATUS.PENDING
      );
      expect(internalNote.body.ticketSummary.internalNoteCount).toBe(1);
      expect(internalNote.body.messageRecord.from).toBeNull();
      expect(internalNote.body.messageRecord.to).toEqual([]);
    }
  );

  maybeDbTest(
    'enforces RBAC, closed-ticket rules, file validation, and invariant failures without leaking workspace data',
    async () => {
      const owner = await createVerifiedUser();
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
      });
      const outsider = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const outsiderContact = await createContactRecord({
        workspaceId: outsider.workspaceId,
      });

      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Message guardrails',
          contactId: String(contact._id),
        },
      });
      expect(created.status).toBe(200);

      const viewerWrite = await createTicketMessageRequest({
        accessToken: viewer.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'Viewer cannot write',
        },
      });
      expect(viewerWrite.status).toBe(403);
      expect(viewerWrite.body.messageKey).toBe('errors.auth.forbiddenRole');

      const invalidConversationId = await request(app)
        .get('/api/tickets/not-a-valid-id/conversation')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(
        invalidConversationId,
        'id',
        'errors.validation.invalidId'
      );

      const invalidType = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: 'system_event',
          bodyText: 'not allowed',
        },
      });
      expectValidationError(
        invalidType,
        'type',
        'errors.validation.invalidEnum'
      );

      const invalidBody = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: '   ',
        },
      });
      expectValidationError(
        invalidBody,
        'bodyText',
        'errors.validation.lengthRange'
      );

      const unknownMessageField = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'unknown field',
          direction: 'inbound',
        },
      });
      expectValidationError(
        unknownMessageField,
        'direction',
        'errors.validation.unknownField'
      );

      const duplicateAttachments = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'duplicate attachment ids',
          attachmentFileIds: [
            '507f1f77bcf86cd799439011',
            '507f1f77bcf86cd799439011',
          ],
        },
      });
      expectValidationError(
        duplicateAttachments,
        'attachmentFileIds',
        'errors.validation.duplicateValues'
      );

      const outsiderTicket = await createTicketRequest({
        accessToken: outsider.accessToken,
        body: {
          subject: 'Other workspace ticket',
          contactId: String(outsiderContact._id),
        },
      });
      expect(outsiderTicket.status).toBe(200);

      const crossWorkspaceList = await request(app)
        .get(`/api/tickets/${outsiderTicket.body.ticket._id}/messages`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(crossWorkspaceList.status).toBe(404);
      expect(crossWorkspaceList.body.messageKey).toBe('errors.ticket.notFound');

      const foreignFileUpload = await uploadTextFile(
        outsider.accessToken,
        'outsider-message-file.txt'
      );
      expect(foreignFileUpload.status).toBe(200);

      const wrongWorkspaceFile = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'wrong workspace file',
          attachmentFileIds: [foreignFileUpload.body.file._id],
        },
      });
      expect(wrongWorkspaceFile.status).toBe(404);
      expect(wrongWorkspaceFile.body.messageKey).toBe('errors.file.notFound');

      const deletedFileUpload = await uploadTextFile(
        owner.accessToken,
        'deleted-file.txt'
      );
      expect(deletedFileUpload.status).toBe(200);
      await request(app)
        .delete(`/api/files/${deletedFileUpload.body.file._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      const deletedFileAttach = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'deleted file',
          attachmentFileIds: [deletedFileUpload.body.file._id],
        },
      });
      expect(deletedFileAttach.status).toBe(404);
      expect(deletedFileAttach.body.messageKey).toBe('errors.file.notFound');

      const failedFileUpload = await uploadTextFile(
        owner.accessToken,
        'failed-file.txt'
      );
      expect(failedFileUpload.status).toBe(200);
      await File.updateOne(
        {
          _id: failedFileUpload.body.file._id,
          workspaceId: owner.workspaceId,
        },
        {
          $set: {
            storageStatus: 'failed',
          },
        }
      );

      const failedFileAttach = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'failed file',
          attachmentFileIds: [failedFileUpload.body.file._id],
        },
      });
      expect(failedFileAttach.status).toBe(404);
      expect(failedFileAttach.body.messageKey).toBe('errors.file.notFound');

      const closedTicket = await Ticket.findById(created.body.ticket._id);
      closedTicket.status = TICKET_STATUS.CLOSED;
      await closedTicket.save();

      const closedPublicReply = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.PUBLIC_REPLY,
          bodyText: 'cannot public reply while closed',
        },
      });
      expect(closedPublicReply.status).toBe(409);
      expect(closedPublicReply.body.messageKey).toBe(
        'errors.ticket.closedMessageNotAllowed'
      );
      expect(closedPublicReply.body.message).toBe(
        t('errors.ticket.closedMessageNotAllowed', 'en', {
          status: { key: 'ticketStatus.closed' },
          type: { key: 'ticketMessageType.public_reply' },
          allowedType: { key: 'ticketMessageType.internal_note' },
        })
      );

      const closedCustomerMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.CUSTOMER_MESSAGE,
          bodyText: 'cannot customer message while closed',
        },
      });
      expect(closedCustomerMessage.status).toBe(409);
      expect(closedCustomerMessage.body.messageKey).toBe(
        'errors.ticket.closedMessageNotAllowed'
      );
      expect(closedCustomerMessage.body.message).toBe(
        t('errors.ticket.closedMessageNotAllowed', 'en', {
          status: { key: 'ticketStatus.closed' },
          type: { key: 'ticketMessageType.customer_message' },
          allowedType: { key: 'ticketMessageType.internal_note' },
        })
      );

      const closedInternalNote = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'closed ticket note still allowed',
        },
      });
      expect(closedInternalNote.status).toBe(200);
      expect(closedInternalNote.body.ticketSummary.status).toBe(
        TICKET_STATUS.CLOSED
      );

      const conversation = await Conversation.findOne({
        workspaceId: owner.workspaceId,
        ticketId: created.body.ticket._id,
        deletedAt: null,
      });
      expect(conversation).toBeTruthy();

      await Conversation.deleteOne({ _id: conversation._id });

      const missingConversation = await request(app)
        .get(`/api/tickets/${created.body.ticket._id}/conversation`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(missingConversation.status).toBe(500);
      expect(missingConversation.body.messageKey).toBe(
        'errors.ticket.conversationInvariantFailed'
      );
    }
  );

  maybeDbTest(
    'rejects attachment reuse across different ticket messages to keep message ownership unique',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Unique attachment ownership',
          contactId: String(contact._id),
        },
      });
      expect(created.status).toBe(200);

      const upload = await uploadTextFile(
        owner.accessToken,
        'unique-message-file.txt'
      );
      expect(upload.status).toBe(200);

      const firstMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'first owner',
          attachmentFileIds: [upload.body.file._id],
        },
      });
      expect(firstMessage.status).toBe(200);

      const secondMessage = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'second owner should fail',
          attachmentFileIds: [upload.body.file._id],
        },
      });

      expect(secondMessage.status).toBe(409);
      expect(secondMessage.body.messageKey).toBe(
        'errors.ticket.attachmentAlreadyLinked'
      );
    }
  );

  maybeDbTest(
    'rolls back message side effects when conversation summary persistence fails',
    async () => {
      const owner = await createVerifiedUser();
      const contact = await createContactRecord({
        workspaceId: owner.workspaceId,
      });
      const created = await createTicketRequest({
        accessToken: owner.accessToken,
        body: {
          subject: 'Rollback message side effects',
          contactId: String(contact._id),
        },
      });
      expect(created.status).toBe(200);

      const upload = await uploadTextFile(
        owner.accessToken,
        'rollback-message.txt'
      );
      expect(upload.status).toBe(200);

      const [ticketBefore, conversationBefore] = await Promise.all([
        Ticket.findById(created.body.ticket._id).lean(),
        Conversation.findById(created.body.ticket.conversationId).lean(),
      ]);

      const saveSpy = jest
        .spyOn(Conversation.prototype, 'save')
        .mockImplementationOnce(async function mockedConversationSave() {
          throw new Error('conversation save failed');
        });

      const response = await createTicketMessageRequest({
        accessToken: owner.accessToken,
        ticketId: created.body.ticket._id,
        body: {
          type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
          bodyText: 'this write should roll back',
          attachmentFileIds: [upload.body.file._id],
        },
      });

      saveSpy.mockRestore();

      expect(response.status).toBe(500);
      expect(response.body.messageKey).toBe('errors.unknown');

      const [ticketAfter, conversationAfter, remainingMessages, activeLinks] =
        await Promise.all([
          Ticket.findById(created.body.ticket._id).lean(),
          Conversation.findById(created.body.ticket.conversationId).lean(),
          Message.find({
            workspaceId: owner.workspaceId,
            ticketId: created.body.ticket._id,
            deletedAt: null,
          }).lean(),
          FileLink.find({
            workspaceId: owner.workspaceId,
            fileId: upload.body.file._id,
            deletedAt: null,
          }).lean(),
        ]);

      expect(ticketAfter.messageCount).toBe(ticketBefore.messageCount);
      expect(ticketAfter.internalNoteCount).toBe(
        ticketBefore.internalNoteCount
      );
      expect(ticketAfter.attachmentCount).toBe(ticketBefore.attachmentCount);
      expect(ticketAfter.lastMessageAt).toEqual(ticketBefore.lastMessageAt);
      expect(ticketAfter.lastMessageType).toBe(ticketBefore.lastMessageType);
      expect(ticketAfter.lastMessagePreview).toBe(
        ticketBefore.lastMessagePreview
      );

      expect(conversationAfter.messageCount).toBe(
        conversationBefore.messageCount
      );
      expect(conversationAfter.internalNoteCount).toBe(
        conversationBefore.internalNoteCount
      );
      expect(conversationAfter.attachmentCount).toBe(
        conversationBefore.attachmentCount
      );
      expect(conversationAfter.lastMessageAt).toEqual(
        conversationBefore.lastMessageAt
      );
      expect(conversationAfter.lastMessageType).toBe(
        conversationBefore.lastMessageType
      );
      expect(conversationAfter.lastMessagePreview).toBe(
        conversationBefore.lastMessagePreview
      );
      expect(remainingMessages).toHaveLength(0);
      expect(activeLinks).toHaveLength(0);
    }
  );
});
