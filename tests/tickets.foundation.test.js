import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app.js';
import { TICKET_CHANNEL } from '../src/constants/ticket-channel.js';
import { TICKET_MESSAGE_TYPE } from '../src/constants/ticket-message-type.js';
import { TICKET_PARTICIPANT_TYPE } from '../src/constants/ticket-participant-type.js';
import { Conversation } from '../src/modules/tickets/models/conversation.model.js';
import { Message } from '../src/modules/tickets/models/message.model.js';
import { TicketParticipant } from '../src/modules/tickets/models/ticket-participant.model.js';
import { TicketTag } from '../src/modules/tickets/models/ticket-tag.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import {
  captureFallbackEmail,
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
    accessToken: verify.body.tokens.accessToken,
    workspaceId: verify.body.user.defaultWorkspaceId,
    userId: verify.body.user._id,
  };
};

describe('Tickets Batch 1 foundation', () => {
  test('GET /api/tickets requires authentication', async () => {
    const response = await request(app).get('/api/tickets');

    expect(response.status).toBe(401);
    expect(response.body.messageKey).toBe('errors.auth.invalidToken');
  });

  maybeDbTest(
    'authenticated active member can access the protected tickets shell',
    async () => {
      const owner = await createVerifiedUser({
        email: 'tickets-foundation-owner@example.com',
      });

      const response = await request(app)
        .get('/api/tickets')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.messageKey).toBe('success.ok');
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(20);
      expect(response.body.total).toBe(0);
      expect(response.body.results).toBe(0);
      expect(response.body.tickets).toEqual([]);
    }
  );

  test('ticket-related models expose the Batch 1 foundation shape', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const mailboxId = new mongoose.Types.ObjectId();
    const ticketId = new mongoose.Types.ObjectId();
    const conversationId = new mongoose.Types.ObjectId();
    const contactId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    const ticket = new Ticket({
      workspaceId,
      mailboxId,
      number: 1,
      subject: 'Foundation ticket',
      contactId,
    });
    await ticket.validate();

    expect(ticket.channel).toBe(TICKET_CHANNEL.MANUAL);
    expect(ticket.tagIds).toEqual([]);
    expect(ticket.schema.path('tags')).toBeUndefined();
    expect(ticket.conversationId).toBeNull();
    expect(ticket.messageCount).toBe(0);
    expect(ticket.publicMessageCount).toBe(0);
    expect(ticket.internalNoteCount).toBe(0);
    expect(ticket.attachmentCount).toBe(0);
    expect(ticket.participantCount).toBe(0);
    expect(ticket.lastMessageType).toBeNull();
    expect(ticket.lastMessagePreview).toBeNull();
    expect(ticket.statusChangedAt).toBeInstanceOf(Date);
    expect(ticket.assignedAt).toBeNull();
    expect(ticket.closedAt).toBeNull();

    const conversation = new Conversation({
      workspaceId,
      ticketId,
      mailboxId,
    });
    await conversation.validate();

    expect(conversation.channel).toBe(TICKET_CHANNEL.MANUAL);
    expect(conversation.messageCount).toBe(0);
    expect(conversation.publicMessageCount).toBe(0);
    expect(conversation.internalNoteCount).toBe(0);
    expect(conversation.attachmentCount).toBe(0);
    expect(conversation.lastMessageType).toBeNull();
    expect(conversation.lastMessagePreview).toBeNull();

    const message = new Message({
      workspaceId,
      conversationId,
      ticketId,
      mailboxId,
      type: TICKET_MESSAGE_TYPE.INTERNAL_NOTE,
      bodyText: 'Internal note',
    });
    await message.validate();

    expect(message.channel).toBe(TICKET_CHANNEL.MANUAL);
    expect(message.direction).toBeNull();
    expect(message.type).toBe(TICKET_MESSAGE_TYPE.INTERNAL_NOTE);

    const participant = new TicketParticipant({
      workspaceId,
      ticketId,
      userId,
    });
    await participant.validate();

    expect(participant.type).toBe(TICKET_PARTICIPANT_TYPE.WATCHER);

    const tag = new TicketTag({
      workspaceId,
      name: 'VIP',
    });
    await tag.validate();

    expect(tag.isActive).toBe(true);
  });
});
