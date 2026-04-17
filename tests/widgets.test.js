import request from 'supertest';
import app from '../src/app.js';
import { realtimeConfig } from '../src/config/realtime.config.js';
import { TICKET_CHANNEL } from '../src/constants/ticket-channel.js';
import { TICKET_STATUS } from '../src/constants/ticket-status.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import { ContactIdentity } from '../src/modules/customers/models/contact-identity.model.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { Message } from '../src/modules/tickets/models/message.model.js';
import { Ticket } from '../src/modules/tickets/models/ticket.model.js';
import { OtpCode } from '../src/modules/users/models/otp-code.model.js';
import { WidgetRecovery } from '../src/modules/widget/models/widget-recovery.model.js';
import { Widget } from '../src/modules/widget/models/widget.model.js';
import { WidgetSession } from '../src/modules/widget/models/widget-session.model.js';
import { createWidgetSessionWithToken } from '../src/modules/widget/services/widget-public.service.js';
import { hashValue } from '../src/shared/utils/security.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { setWorkspaceBillingPlanForTests } from './helpers/billing.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const deriveUserName = ({ email, fallback = 'Test User' }) => {
  const localPart = String(email || '')
    .split('@')[0]
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  return localPart || fallback;
};

const signupAndCaptureOtp = async ({
  email,
  password = 'Password123!',
  name = undefined,
}) => {
  const { response, logs } = await captureFallbackEmail(() =>
    request(app).post('/api/auth/signup').send({
      email,
      password,
      name: name || deriveUserName({ email }),
    })
  );

  return {
    response,
    code: extractOtpCodeFromLogs(logs),
  };
};

const createVerifiedUser = async ({
  email,
  password = 'Password123!',
  name = undefined,
}) => {
  const signup = await signupAndCaptureOtp({
    email,
    password,
    name: name || deriveUserName({ email }),
  });
  expect(signup.response.status).toBe(200);
  expect(signup.code).toBeTruthy();

  const verify = await request(app).post('/api/auth/verify-email').send({
    email,
    code: signup.code,
  });
  expect(verify.status).toBe(200);

  await setWorkspaceBillingPlanForTests({
    workspaceId: verify.body.user.defaultWorkspaceId,
    planKey: 'business',
  });

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

  return request(app)
    .post('/api/mailboxes')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
};

const createWidget = async ({
  accessToken,
  name,
  mailboxId,
  branding = undefined,
  behavior = undefined,
}) => {
  const body = {
    name,
    mailboxId,
  };

  if (branding !== undefined) {
    body.branding = branding;
  }

  if (behavior !== undefined) {
    body.behavior = behavior;
  }

  return request(app)
    .post('/api/widgets')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
};

const initializePublicWidgetSession = async ({
  publicKey,
  sessionToken = undefined,
}) => {
  const body = {};

  if (sessionToken !== undefined) {
    body.sessionToken = sessionToken;
  }

  return request(app).post(`/api/widgets/public/${publicKey}/session`).send(body);
};

const createPublicWidgetMessage = async ({
  publicKey,
  sessionToken,
  name = undefined,
  email = undefined,
  message,
}) => {
  const body = {
    sessionToken,
    message,
  };

  if (name !== undefined) {
    body.name = name;
  }

  if (email !== undefined) {
    body.email = email;
  }

  return request(app).post(`/api/widgets/public/${publicKey}/messages`).send(body);
};

const requestPublicWidgetRecovery = async ({ publicKey, email }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/request`)
    .send({ email });

const verifyPublicWidgetRecovery = async ({ publicKey, email, code }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/verify`)
    .send({ email, code });

const continuePublicWidgetRecovery = async ({ publicKey, recoveryToken }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/continue`)
    .send({ recoveryToken });

const startNewPublicWidgetRecovery = async ({ publicKey, recoveryToken }) =>
  request(app)
    .post(`/api/widgets/public/${publicKey}/recovery/start-new`)
    .send({ recoveryToken });

describe('Widget foundations + management endpoints', () => {
  maybeDbTest(
    'owner and admin can create widgets and public bootstrap returns safe config',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-owner-create@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Widget Mailbox',
        emailAddress: 'widget-owner-create-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const ownerCreate = await createWidget({
        accessToken: owner.accessToken,
        name: 'Main Support Widget',
        mailboxId: mailbox.body.mailbox._id,
        branding: {
          displayName: 'Support Team',
          accentColor: '#1453ff',
          welcomeTitle: 'How can we help?',
        },
        behavior: {
          defaultLocale: 'ar',
          collectName: true,
          collectEmail: true,
        },
      });

      expect(ownerCreate.status).toBe(200);
      expect(ownerCreate.body.messageKey).toBe('success.widget.created');
      expect(ownerCreate.body.widget.publicKey).toMatch(/^wgt_[a-f0-9]{32}$/);
      expect(ownerCreate.body.widget.mailbox._id).toBe(
        mailbox.body.mailbox._id
      );

      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'widget-admin-create@example.com',
      });

      const adminCreate = await createWidget({
        accessToken: admin.accessToken,
        name: 'Escalations Widget',
        mailboxId: mailbox.body.mailbox._id,
      });

      expect(adminCreate.status).toBe(200);
      expect(adminCreate.body.messageKey).toBe('success.widget.created');

      const bootstrap = await request(app).get(
        `/api/widgets/public/${ownerCreate.body.widget.publicKey}/bootstrap`
      );

      expect(bootstrap.status).toBe(200);
      expect(bootstrap.body.messageKey).toBe('success.ok');
      expect(bootstrap.body.widget.publicKey).toBe(
        ownerCreate.body.widget.publicKey
      );
      expect(bootstrap.body.widget.locale).toBe('ar');
      expect(bootstrap.body.widget.branding.displayName).toBe('Support Team');
      expect(bootstrap.body.widget.capabilities).toEqual({
        messaging: true,
        verifiedRecovery: true,
        realtime: true,
      });
      expect(bootstrap.body.realtime).toEqual(
        expect.objectContaining({
          enabled: realtimeConfig.enabled,
          auth: expect.objectContaining({
            mode: 'widget_session',
            field: 'widgetSessionToken',
            tokenPrefix: 'wgs_',
          }),
          subscribeEvent: 'widget.subscribe',
          unsubscribeEvent: 'widget.unsubscribe',
          events: expect.arrayContaining([
            'widget.message.created',
            'widget.conversation.updated',
          ]),
        })
      );
      expect(bootstrap.body.widget.workspaceId).toBeUndefined();
      expect(bootstrap.body.widget.mailboxId).toBeUndefined();
    }
  );

  maybeDbTest('agent and viewer are read-only for widgets', async () => {
    const owner = await createVerifiedUser({
      email: 'widget-rbac-owner@example.com',
    });

    const mailbox = await createMailbox({
      accessToken: owner.accessToken,
      name: 'Read Widget Mailbox',
      emailAddress: 'widget-rbac-mailbox@example.com',
    });
    expect(mailbox.status).toBe(200);

    const widget = await createWidget({
      accessToken: owner.accessToken,
      name: 'Read Only Widget',
      mailboxId: mailbox.body.mailbox._id,
    });
    expect(widget.status).toBe(200);

    const agent = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.AGENT,
      email: 'widget-rbac-agent@example.com',
    });
    const viewer = await createWorkspaceScopedTokenForRole({
      owner,
      roleKey: WORKSPACE_ROLES.VIEWER,
      email: 'widget-rbac-viewer@example.com',
    });

    const agentList = await request(app)
      .get('/api/widgets')
      .set('Authorization', `Bearer ${agent.accessToken}`);
    expect(agentList.status).toBe(200);
    expect(agentList.body.widgets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _id: widget.body.widget._id,
        }),
      ])
    );

    const viewerDetail = await request(app)
      .get(`/api/widgets/${widget.body.widget._id}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(viewerDetail.status).toBe(200);
    expect(viewerDetail.body.widget._id).toBe(widget.body.widget._id);

    const agentCreate = await createWidget({
      accessToken: agent.accessToken,
      name: 'Should Fail Agent',
      mailboxId: mailbox.body.mailbox._id,
    });
    expect(agentCreate.status).toBe(403);
    expect(agentCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

    const viewerPatch = await request(app)
      .patch(`/api/widgets/${widget.body.widget._id}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ name: 'Should Fail Viewer' });
    expect(viewerPatch.status).toBe(403);
    expect(viewerPatch.body.messageKey).toBe('errors.auth.forbiddenRole');

    const agentDeactivate = await request(app)
      .post(`/api/widgets/${widget.body.widget._id}/deactivate`)
      .set('Authorization', `Bearer ${agent.accessToken}`)
      .send({});
    expect(agentDeactivate.status).toBe(403);
    expect(agentDeactivate.body.messageKey).toBe('errors.auth.forbiddenRole');
  });

  maybeDbTest(
    'widget create and update enforce active same-workspace mailbox selection',
    async () => {
      const ownerA = await createVerifiedUser({
        email: 'widget-mailbox-owner-a@example.com',
      });
      const ownerB = await createVerifiedUser({
        email: 'widget-mailbox-owner-b@example.com',
      });

      const mailboxA = await createMailbox({
        accessToken: ownerA.accessToken,
        name: 'Owner A Widget Mailbox',
        emailAddress: 'widget-mailbox-a@example.com',
      });
      const mailboxB = await createMailbox({
        accessToken: ownerB.accessToken,
        name: 'Owner B Widget Mailbox',
        emailAddress: 'widget-mailbox-b@example.com',
      });

      expect(mailboxA.status).toBe(200);
      expect(mailboxB.status).toBe(200);

      const crossWorkspaceCreate = await createWidget({
        accessToken: ownerA.accessToken,
        name: 'Cross Workspace Widget',
        mailboxId: mailboxB.body.mailbox._id,
      });
      expect(crossWorkspaceCreate.status).toBe(404);
      expect(crossWorkspaceCreate.body.messageKey).toBe(
        'errors.mailbox.notFound'
      );

      const inactiveMailbox = await createMailbox({
        accessToken: ownerA.accessToken,
        name: 'Inactive Widget Mailbox',
        emailAddress: 'widget-mailbox-inactive@example.com',
      });
      expect(inactiveMailbox.status).toBe(200);

      const deactivateMailbox = await request(app)
        .post(`/api/mailboxes/${inactiveMailbox.body.mailbox._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({});
      expect(deactivateMailbox.status).toBe(200);

      const inactiveMailboxCreate = await createWidget({
        accessToken: ownerA.accessToken,
        name: 'Inactive Mailbox Widget',
        mailboxId: inactiveMailbox.body.mailbox._id,
      });
      expect(inactiveMailboxCreate.status).toBe(404);
      expect(inactiveMailboxCreate.body.messageKey).toBe(
        'errors.mailbox.notFound'
      );

      const validWidget = await createWidget({
        accessToken: ownerA.accessToken,
        name: 'Same Workspace Widget',
        mailboxId: mailboxA.body.mailbox._id,
      });
      expect(validWidget.status).toBe(200);

      const invalidUpdate = await request(app)
        .patch(`/api/widgets/${validWidget.body.widget._id}`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          mailboxId: mailboxB.body.mailbox._id,
        });

      expect(invalidUpdate.status).toBe(404);
      expect(invalidUpdate.body.messageKey).toBe('errors.mailbox.notFound');
    }
  );

  maybeDbTest(
    'widget list, options, and detail follow inactive visibility rules',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-visibility-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Visibility Widget Mailbox',
        emailAddress: 'widget-visibility-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const activeWidget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Visible Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      const inactiveWidget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Hidden Widget',
        mailboxId: mailbox.body.mailbox._id,
      });

      expect(activeWidget.status).toBe(200);
      expect(inactiveWidget.status).toBe(200);

      const deactivateWidgetResponse = await request(app)
        .post(`/api/widgets/${inactiveWidget.body.widget._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivateWidgetResponse.status).toBe(200);
      expect(deactivateWidgetResponse.body.widget).toEqual({
        _id: inactiveWidget.body.widget._id,
        isActive: false,
      });

      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'widget-visibility-agent@example.com',
      });

      const agentList = await request(app)
        .get('/api/widgets')
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentList.status).toBe(200);
      const agentListIds = new Set(
        agentList.body.widgets.map((item) => item._id)
      );
      expect(agentListIds.has(activeWidget.body.widget._id)).toBe(true);
      expect(agentListIds.has(inactiveWidget.body.widget._id)).toBe(false);

      const ownerInactiveList = await request(app)
        .get('/api/widgets?includeInactive=true&isActive=false')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerInactiveList.status).toBe(200);
      expect(ownerInactiveList.body.widgets).toHaveLength(1);
      expect(ownerInactiveList.body.widgets[0]._id).toBe(
        inactiveWidget.body.widget._id
      );

      const optionsDefault = await request(app)
        .get('/api/widgets/options')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(optionsDefault.status).toBe(200);
      const optionIds = new Set(
        optionsDefault.body.options.map((item) => item._id)
      );
      expect(optionIds.has(inactiveWidget.body.widget._id)).toBe(false);

      const agentInactiveDetail = await request(app)
        .get(`/api/widgets/${inactiveWidget.body.widget._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentInactiveDetail.status).toBe(404);
      expect(agentInactiveDetail.body.messageKey).toBe(
        'errors.widget.notFound'
      );

      const agentInactiveQuery = await request(app)
        .get('/api/widgets?includeInactive=true')
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentInactiveQuery.status).toBe(403);
      expect(agentInactiveQuery.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );
    }
  );

  maybeDbTest(
    'widget patch validates unknown fields, nested unknown fields, and empty update bodies',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-validation-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Validation Widget Mailbox',
        emailAddress: 'widget-validation-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Validation Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const unknownFieldPatch = await request(app)
        .patch(`/api/widgets/${widget.body.widget._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          unknownField: 'should-fail',
        });

      expect(unknownFieldPatch.status).toBe(422);
      expect(unknownFieldPatch.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'unknownField',
            messageKey: 'errors.validation.unknownField',
          }),
        ])
      );

      const nestedUnknownPatch = await request(app)
        .patch(`/api/widgets/${widget.body.widget._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          branding: {
            unsupported: 'value',
          },
        });

      expect(nestedUnknownPatch.status).toBe(422);
      expect(nestedUnknownPatch.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'branding.unsupported',
            messageKey: 'errors.validation.unknownField',
          }),
        ])
      );

      const emptyBodyPatch = await request(app)
        .patch(`/api/widgets/${widget.body.widget._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(emptyBodyPatch.status).toBe(422);
      expect(emptyBodyPatch.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'body',
            messageKey: 'errors.validation.bodyRequiresAtLeastOneField',
          }),
        ])
      );
    }
  );

  maybeDbTest(
    'public bootstrap safely hides missing, inactive, and mailbox-broken widgets',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-bootstrap-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Bootstrap Widget Mailbox',
        emailAddress: 'widget-bootstrap-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const activeWidget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Bootstrap Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(activeWidget.status).toBe(200);

      const unknownBootstrap = await request(app).get(
        '/api/widgets/public/wgt_1234567890abcdef1234567890abcdef/bootstrap'
      );
      expect(unknownBootstrap.status).toBe(404);
      expect(unknownBootstrap.body.messageKey).toBe('errors.widget.notFound');

      const deactivateWidgetResponse = await request(app)
        .post(`/api/widgets/${activeWidget.body.widget._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivateWidgetResponse.status).toBe(200);

      const inactiveBootstrap = await request(app).get(
        `/api/widgets/public/${activeWidget.body.widget.publicKey}/bootstrap`
      );
      expect(inactiveBootstrap.status).toBe(404);
      expect(inactiveBootstrap.body.messageKey).toBe('errors.widget.notFound');

      const secondWidget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Broken Mailbox Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(secondWidget.status).toBe(200);

      await Mailbox.updateOne(
        { _id: mailbox.body.mailbox._id, workspaceId: owner.workspaceId },
        { $set: { isActive: false } }
      );

      const brokenMailboxBootstrap = await request(app).get(
        `/api/widgets/public/${secondWidget.body.widget.publicKey}/bootstrap`
      );
      expect(brokenMailboxBootstrap.status).toBe(404);
      expect(brokenMailboxBootstrap.body.messageKey).toBe(
        'errors.widget.notFound'
      );
    }
  );

  maybeDbTest(
    'widget activation requires the linked mailbox to stay active',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-activate-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Activation Widget Mailbox',
        emailAddress: 'widget-activation-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Activation Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const deactivateWidgetResponse = await request(app)
        .post(`/api/widgets/${widget.body.widget._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivateWidgetResponse.status).toBe(200);

      await Mailbox.updateOne(
        { _id: mailbox.body.mailbox._id, workspaceId: owner.workspaceId },
        { $set: { isActive: false } }
      );

      const activateResponse = await request(app)
        .post(`/api/widgets/${widget.body.widget._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(activateResponse.status).toBe(404);
      expect(activateResponse.body.messageKey).toBe('errors.mailbox.notFound');
    }
  );

  maybeDbTest(
    'widgets remain workspace-isolated for internal reads',
    async () => {
      const ownerA = await createVerifiedUser({
        email: 'widget-isolation-owner-a@example.com',
      });
      const ownerB = await createVerifiedUser({
        email: 'widget-isolation-owner-b@example.com',
      });

      const mailboxA = await createMailbox({
        accessToken: ownerA.accessToken,
        name: 'Isolation Mailbox A',
        emailAddress: 'widget-isolation-a@example.com',
      });
      expect(mailboxA.status).toBe(200);

      const widgetA = await createWidget({
        accessToken: ownerA.accessToken,
        name: 'Isolation Widget A',
        mailboxId: mailboxA.body.mailbox._id,
      });
      expect(widgetA.status).toBe(200);

      const ownerBGetA = await request(app)
        .get(`/api/widgets/${widgetA.body.widget._id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(ownerBGetA.status).toBe(404);
      expect(ownerBGetA.body.messageKey).toBe('errors.widget.notFound');

      const ownerBList = await request(app)
        .get('/api/widgets')
        .set('Authorization', `Bearer ${ownerB.accessToken}`);
      expect(ownerBList.status).toBe(200);
      const ownerBIds = new Set(
        ownerBList.body.widgets.map((item) => item._id)
      );
      expect(ownerBIds.has(widgetA.body.widget._id)).toBe(false);
    }
  );

  maybeDbTest(
    'widget patch supports partial nested updates without resetting sibling values',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-partial-update-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Partial Update Mailbox',
        emailAddress: 'widget-partial-update-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Partial Update Widget',
        mailboxId: mailbox.body.mailbox._id,
        branding: {
          displayName: 'Support Desk',
          accentColor: '#1144aa',
        },
        behavior: {
          defaultLocale: 'en',
          collectName: true,
          collectEmail: false,
        },
      });
      expect(widget.status).toBe(200);

      const patchResponse = await request(app)
        .patch(`/api/widgets/${widget.body.widget._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          branding: {
            welcomeTitle: 'Need help?',
          },
          behavior: {
            collectEmail: true,
          },
        });

      expect(patchResponse.status).toBe(200);
      expect(patchResponse.body.widget.branding.displayName).toBe(
        'Support Desk'
      );
      expect(patchResponse.body.widget.branding.accentColor).toBe('#1144aa');
      expect(patchResponse.body.widget.branding.welcomeTitle).toBe(
        'Need help?'
      );
      expect(patchResponse.body.widget.behavior.defaultLocale).toBe('en');
      expect(patchResponse.body.widget.behavior.collectName).toBe(true);
      expect(patchResponse.body.widget.behavior.collectEmail).toBe(true);

      const persisted = await Widget.findById(widget.body.widget._id).lean();
      expect(persisted.branding.displayName).toBe('Support Desk');
      expect(persisted.branding.accentColor).toBe('#1144aa');
      expect(persisted.branding.welcomeTitle).toBe('Need help?');
      expect(persisted.behavior.defaultLocale).toBe('en');
      expect(persisted.behavior.collectName).toBe(true);
      expect(persisted.behavior.collectEmail).toBe(true);
    }
  );

  maybeDbTest(
    'public widget session init creates and reuses a browser session safely',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-session-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public Session Mailbox',
        emailAddress: 'widget-public-session-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public Session Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const firstInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(firstInit.status).toBe(200);
      expect(firstInit.body.messageKey).toBe(
        'success.widget.sessionInitialized'
      );
      expect(firstInit.body.session.token).toMatch(/^wgs_[a-f0-9]{48}$/);
      expect(firstInit.body.realtime).toEqual(
        expect.objectContaining({
          enabled: realtimeConfig.enabled,
          auth: expect.objectContaining({
            mode: 'widget_session',
            field: 'widgetSessionToken',
          }),
          subscribeEvent: 'widget.subscribe',
        })
      );
      expect(firstInit.body.conversation).toEqual({
        state: 'idle',
        ticketStatus: null,
        lastMessageAt: null,
        messageCount: 0,
        publicMessageCount: 0,
        messages: [],
      });

      const storedSession = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(firstInit.body.session.token),
        deletedAt: null,
      }).lean();
      expect(storedSession).toBeTruthy();

      const resumedInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
        sessionToken: firstInit.body.session.token,
      });
      expect(resumedInit.status).toBe(200);
      expect(resumedInit.body.session.token).toBe(firstInit.body.session.token);

      const sessionCount = await WidgetSession.countDocuments({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        deletedAt: null,
      });
      expect(sessionCount).toBe(1);
    }
  );

  maybeDbTest(
    'public widget first message creates CRM contact, widget ticket, and session linkage',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-first-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public First Mailbox',
        emailAddress: 'widget-public-first-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public First Widget',
        mailboxId: mailbox.body.mailbox._id,
        behavior: {
          collectName: true,
          collectEmail: true,
        },
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const firstMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: `  ${init.body.session.token}  `,
        name: 'Jane Visitor',
        email: 'widget-first-visitor@example.com',
        message: 'Need help with billing.',
      });

      expect(firstMessage.status).toBe(200);
      expect(firstMessage.body.messageKey).toBe('success.widget.messageCreated');
      expect(firstMessage.body.session.token).toBe(init.body.session.token);
      expect(firstMessage.body.message.type).toBe('customer_message');
      expect(firstMessage.body.message.direction).toBe('inbound');
      expect(firstMessage.body.message.sender).toBe('customer');
      expect(firstMessage.body.conversation.ticketStatus).toBe(
        TICKET_STATUS.OPEN
      );
      expect(firstMessage.body.conversation.messageCount).toBe(1);

      const session = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();
      expect(session).toBeTruthy();
      expect(session.contactId).toBeTruthy();
      expect(session.ticketId).toBeTruthy();

      const contact = await Contact.findOne({
        _id: session.contactId,
        workspaceId: owner.workspaceId,
        deletedAt: null,
      }).lean();
      expect(contact).toBeTruthy();
      expect(contact.fullName).toBe('Jane Visitor');
      expect(contact.email).toBe('widget-first-visitor@example.com');

      const emailIdentity = await ContactIdentity.findOne({
        workspaceId: owner.workspaceId,
        contactId: contact._id,
        type: 'email',
        valueNormalized: 'widget-first-visitor@example.com',
        deletedAt: null,
      }).lean();
      expect(emailIdentity).toBeTruthy();

      const ticket = await Ticket.findOne({
        _id: session.ticketId,
        workspaceId: owner.workspaceId,
        deletedAt: null,
      }).lean();
      expect(ticket).toBeTruthy();
      expect(ticket.channel).toBe(TICKET_CHANNEL.WIDGET);
      expect(String(ticket.mailboxId)).toBe(mailbox.body.mailbox._id);
      expect(String(ticket.contactId)).toBe(String(contact._id));
      expect(String(ticket.widgetId)).toBe(widget.body.widget._id);
      expect(String(ticket.widgetSessionId)).toBe(String(session._id));
      expect(ticket.status).toBe(TICKET_STATUS.OPEN);

      const message = await Message.findOne({
        workspaceId: owner.workspaceId,
        ticketId: ticket._id,
        deletedAt: null,
      }).lean();
      expect(message).toBeTruthy();
      expect(message.channel).toBe(TICKET_CHANNEL.WIDGET);
      expect(message.type).toBe('customer_message');
      expect(message.bodyText).toBe('Need help with billing.');
    }
  );

  maybeDbTest(
    'public widget behavior collectName and collectEmail remain frontend hints instead of backend-required fields',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-hints-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public Hints Mailbox',
        emailAddress: 'widget-public-hints-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public Hints Widget',
        mailboxId: mailbox.body.mailbox._id,
        behavior: {
          collectName: true,
          collectEmail: true,
        },
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);
      expect(init.body.widget?.behavior).toBeUndefined();

      const messageResponse = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'No name or email supplied.',
      });

      expect(messageResponse.status).toBe(200);
      expect(messageResponse.body.messageKey).toBe(
        'success.widget.messageCreated'
      );
      expect(messageResponse.body.session.token).toBe(init.body.session.token);
      expect(messageResponse.body.conversation.ticketStatus).toBe(
        TICKET_STATUS.OPEN
      );

      const session = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();

      const contact = await Contact.findById(session.contactId).lean();
      expect(contact).toBeTruthy();
      expect(contact.email).toBeNull();
      expect(contact.fullName).toMatch(/^Widget visitor /);
    }
  );

  maybeDbTest(
    'public widget follow-up messages append to the current eligible ticket',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-followup-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public Follow-up Mailbox',
        emailAddress: 'widget-public-followup-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public Follow-up Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const firstMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'First widget message.',
      });
      expect(firstMessage.status).toBe(200);

      const sessionAfterFirst = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();

      const secondMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'Second widget message.',
      });
      expect(secondMessage.status).toBe(200);
      expect(secondMessage.body.conversation.messageCount).toBe(2);
      expect(secondMessage.body.conversation.ticketStatus).toBe(
        TICKET_STATUS.OPEN
      );

      const ticketCount = await Ticket.countDocuments({
        workspaceId: owner.workspaceId,
        widgetSessionId: sessionAfterFirst._id,
        deletedAt: null,
      });
      expect(ticketCount).toBe(1);

      const ticket = await Ticket.findOne({
        workspaceId: owner.workspaceId,
        widgetSessionId: sessionAfterFirst._id,
        deletedAt: null,
      }).lean();
      expect(ticket.messageCount).toBe(2);
    }
  );

  maybeDbTest(
    'public widget creates a new ticket after the current session ticket is closed',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-closed-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public Closed Mailbox',
        emailAddress: 'widget-public-closed-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public Closed Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const firstMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'Please close this out.',
      });
      expect(firstMessage.status).toBe(200);

      const sessionBeforeClose = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      });
      expect(sessionBeforeClose).toBeTruthy();

      const firstTicket = await Ticket.findById(sessionBeforeClose.ticketId);
      firstTicket.status = TICKET_STATUS.CLOSED;
      await firstTicket.save();

      const secondMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'I have one more question.',
      });
      expect(secondMessage.status).toBe(200);
      expect(secondMessage.body.conversation.messageCount).toBe(1);
      expect(secondMessage.body.conversation.ticketStatus).toBe(
        TICKET_STATUS.OPEN
      );

      const tickets = await Ticket.find({
        workspaceId: owner.workspaceId,
        widgetSessionId: sessionBeforeClose._id,
        deletedAt: null,
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();

      expect(tickets).toHaveLength(2);
      expect(tickets[0].status).toBe(TICKET_STATUS.CLOSED);
      expect(tickets[1].status).toBe(TICKET_STATUS.OPEN);

      const sessionAfterSecond = await WidgetSession.findById(
        sessionBeforeClose._id
      ).lean();
      expect(String(sessionAfterSecond.ticketId)).toBe(String(tickets[1]._id));
    }
  );

  maybeDbTest(
    'public widget email-first matching reuses an existing CRM contact',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-contact-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public Contact Mailbox',
        emailAddress: 'widget-public-contact-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public Contact Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const existingContact = await Contact.create({
        workspaceId: owner.workspaceId,
        fullName: 'Existing Contact',
        email: 'existing-widget-contact@example.com',
      });
      await ContactIdentity.create({
        workspaceId: owner.workspaceId,
        contactId: existingContact._id,
        type: 'email',
        value: 'existing-widget-contact@example.com',
        verifiedAt: null,
      });

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const publicMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        email: 'existing-widget-contact@example.com',
        message: 'Reusing my existing contact record.',
      });
      expect(publicMessage.status).toBe(200);

      const session = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();

      expect(String(session.contactId)).toBe(String(existingContact._id));

      const ticket = await Ticket.findById(session.ticketId).lean();
      expect(String(ticket.contactId)).toBe(String(existingContact._id));

      const contactCount = await Contact.countDocuments({
        workspaceId: owner.workspaceId,
        emailNormalized: 'existing-widget-contact@example.com',
        deletedAt: null,
      });
      expect(contactCount).toBe(1);
    }
  );

  maybeDbTest(
    'public session init can resume current conversation state while hiding internal details',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-state-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public State Mailbox',
        emailAddress: 'widget-public-state-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public State Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const inbound = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        name: 'Reload Visitor',
        email: 'widget-public-state-visitor@example.com',
        message: 'Initial public widget message.',
      });
      expect(inbound.status).toBe(200);

      const session = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();

      const agentReply = await request(app)
        .post(`/api/tickets/${session.ticketId}/messages`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          type: 'public_reply',
          bodyText: 'Agent response for reload state.',
        });
      expect(agentReply.status).toBe(200);

      const resumed = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
      });
      expect(resumed.status).toBe(200);
      expect(resumed.body.conversation.ticketStatus).toBe(
        TICKET_STATUS.WAITING_ON_CUSTOMER
      );
      expect(resumed.body.conversation.messageCount).toBe(2);
      expect(resumed.body.conversation.messages).toEqual([
        expect.objectContaining({
          type: 'customer_message',
          sender: 'customer',
          bodyText: 'Initial public widget message.',
        }),
        expect.objectContaining({
          type: 'public_reply',
          sender: 'agent',
          bodyText: 'Agent response for reload state.',
        }),
      ]);
      expect(resumed.body.conversation.messages[1].createdBy).toBeUndefined();
    }
  );

  maybeDbTest(
    'public widget message flow validates payloads and safely handles stale sessions and inactive widgets',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-public-validation-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Public Validation Mailbox',
        emailAddress: 'widget-public-validation-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Public Validation Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const invalidMessage = await request(app)
        .post(`/api/widgets/public/${widget.body.widget.publicKey}/messages`)
        .send({
          sessionToken: 'bad-session-token',
          email: 'not-an-email',
          message: '',
          extraField: true,
        });

      expect(invalidMessage.status).toBe(422);
      expect(invalidMessage.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'sessionToken',
            messageKey: 'errors.validation.invalid',
          }),
          expect.objectContaining({
            field: 'email',
            messageKey: 'errors.validation.invalidEmail',
          }),
          expect.objectContaining({
            field: 'message',
            messageKey: 'errors.validation.lengthRange',
          }),
          expect.objectContaining({
            field: 'extraField',
            messageKey: 'errors.validation.unknownField',
          }),
        ])
      );

      const staleSession = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: 'wgs_1234567890abcdef1234567890abcdef1234567890abcdef',
        message: 'This should fail.',
      });
      expect(staleSession.status).toBe(404);
      expect(staleSession.body.messageKey).toBe('errors.widget.sessionNotFound');

      await request(app)
        .post(`/api/widgets/${widget.body.widget._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      const inactiveInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(inactiveInit.status).toBe(404);
      expect(inactiveInit.body.messageKey).toBe('errors.widget.notFound');
    }
  );

  maybeDbTest(
    'public widget recovery request stays generic and verify returns the latest eligible widget candidate',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-recovery-verify-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Recovery Verify Mailbox',
        emailAddress: 'widget-recovery-verify-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Recovery Verify Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const firstInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(firstInit.status).toBe(200);

      const firstMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: firstInit.body.session.token,
        email: 'widget-recovery-candidate@example.com',
        message: 'Older recoverable widget message.',
      });
      expect(firstMessage.status).toBe(200);

      const secondInit = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(secondInit.status).toBe(200);

      const secondMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: secondInit.body.session.token,
        email: 'widget-recovery-candidate@example.com',
        message: 'Latest but closed widget message.',
      });
      expect(secondMessage.status).toBe(200);

      const sessions = await WidgetSession.find({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        deletedAt: null,
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();

      const firstTicket = await Ticket.findById(sessions[0].ticketId);
      const secondTicket = await Ticket.findById(sessions[1].ticketId);
      secondTicket.status = TICKET_STATUS.CLOSED;
      await secondTicket.save();

      const unknownRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-recovery-unknown@example.com',
        })
      );
      expect(unknownRequest.response.status).toBe(200);
      expect(unknownRequest.response.body.messageKey).toBe(
        'success.widget.recoveryRequested'
      );
      expect(extractOtpCodeFromLogs(unknownRequest.logs)).toBeNull();

      const recoveryRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-recovery-candidate@example.com',
        })
      );
      expect(recoveryRequest.response.status).toBe(200);
      expect(recoveryRequest.response.body.messageKey).toBe(
        'success.widget.recoveryRequested'
      );

      const otpCode = extractOtpCodeFromLogs(recoveryRequest.logs);
      expect(otpCode).toBeTruthy();

      const verify = await verifyPublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        email: 'widget-recovery-candidate@example.com',
        code: otpCode,
      });
      expect(verify.status).toBe(200);
      expect(verify.body.messageKey).toBe('success.widget.recoveryVerified');
      expect(verify.body.recovery.token).toMatch(/^wgr_[a-f0-9]{48}$/);
      expect(verify.body.recovery.options).toEqual({
        canContinue: true,
        canStartNew: true,
      });
      expect(verify.body.recovery.candidate).toEqual(
        expect.objectContaining({
          state: 'active',
          ticketStatus: TICKET_STATUS.OPEN,
          messageCount: 1,
          publicMessageCount: 0,
        })
      );

      const recoveryRecord = await WidgetRecovery.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        recoveryTokenHash: hashValue(verify.body.recovery.token),
      }).lean();
      expect(String(recoveryRecord.candidateTicketId)).toBe(
        String(firstTicket._id)
      );
    }
  );

  maybeDbTest(
    'public widget recovery continue issues a fresh session and resumes the same ticket in the same widget',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-recovery-continue-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Recovery Continue Mailbox',
        emailAddress: 'widget-recovery-continue-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Recovery Continue Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const firstMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        email: 'widget-recovery-continue@example.com',
        message: 'I need to recover this conversation.',
      });
      expect(firstMessage.status).toBe(200);

      const originalSession = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();
      const supersededSession = await createWidgetSessionWithToken({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        sessionSeed: {
          contactId: originalSession.contactId,
          organizationId: originalSession.organizationId,
          ticketId: originalSession.ticketId,
          recoveryVerifiedAt: new Date(),
          recoveredFromSessionId: originalSession._id,
        },
      });

      const agentReply = await request(app)
        .post(`/api/tickets/${originalSession.ticketId}/messages`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          type: 'public_reply',
          bodyText: 'Agent reply before recovery.',
        });
      expect(agentReply.status).toBe(200);

      const recoveryRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-recovery-continue@example.com',
        })
      );
      const otpCode = extractOtpCodeFromLogs(recoveryRequest.logs);
      expect(otpCode).toBeTruthy();

      const verify = await verifyPublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        email: 'widget-recovery-continue@example.com',
        code: otpCode,
      });
      expect(verify.status).toBe(200);

      const continued = await continuePublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        recoveryToken: verify.body.recovery.token,
      });
      expect(continued.status).toBe(200);
      expect(continued.body.messageKey).toBe(
        'success.widget.recoveryContinued'
      );
      expect(continued.body.session.token).toMatch(/^wgs_[a-f0-9]{48}$/);
      expect(continued.body.session.token).not.toBe(init.body.session.token);
      expect(continued.body.session.recoveryVerified).toBe(true);
      expect(continued.body.conversation.messageCount).toBe(2);
      expect(continued.body.conversation.messages).toEqual([
        expect.objectContaining({
          type: 'customer_message',
          bodyText: 'I need to recover this conversation.',
        }),
        expect.objectContaining({
          type: 'public_reply',
          bodyText: 'Agent reply before recovery.',
        }),
      ]);

      const recoveredSession = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(continued.body.session.token),
        deletedAt: null,
      }).lean();
      expect(recoveredSession).toBeTruthy();
      expect(String(recoveredSession.ticketId)).toBe(
        String(originalSession.ticketId)
      );
      expect(String(recoveredSession.recoveredFromSessionId)).toBe(
        String(supersededSession.session._id)
      );
      expect(recoveredSession.recoveryVerifiedAt).toBeTruthy();

      const invalidatedOriginalSession = await WidgetSession.findById(
        originalSession._id
      ).lean();
      const invalidatedSupersededSession = await WidgetSession.findById(
        supersededSession.session._id
      ).lean();
      expect(invalidatedOriginalSession.invalidatedAt).toBeTruthy();
      expect(invalidatedOriginalSession.publicSessionKeyHash).toBeNull();
      expect(invalidatedSupersededSession.invalidatedAt).toBeTruthy();
      expect(invalidatedSupersededSession.publicSessionKeyHash).toBeNull();

      const staleMessageAttempt = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'Stale token should no longer send.',
      });
      expect(staleMessageAttempt.status).toBe(404);
      expect(staleMessageAttempt.body.messageKey).toBe(
        'errors.widget.sessionNotFound'
      );

      const staleResumeAttempt = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
      });
      expect(staleResumeAttempt.status).toBe(200);
      expect(staleResumeAttempt.body.session.token).not.toBe(
        init.body.session.token
      );
      expect(staleResumeAttempt.body.session.token).not.toBe(
        continued.body.session.token
      );
      expect(staleResumeAttempt.body.conversation).toEqual({
        state: 'idle',
        ticketStatus: null,
        lastMessageAt: null,
        messageCount: 0,
        publicMessageCount: 0,
        messages: [],
      });

      const followUp = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: continued.body.session.token,
        message: 'Recovered follow-up message.',
      });
      expect(followUp.status).toBe(200);
      expect(followUp.body.conversation.messageCount).toBe(3);

      const ticket = await Ticket.findById(originalSession.ticketId).lean();
      expect(ticket.messageCount).toBe(3);

      const consumedRecovery = await WidgetRecovery.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        recoveryTokenHash: hashValue(verify.body.recovery.token),
      }).lean();
      expect(consumedRecovery.consumedAt).toBeTruthy();
      expect(consumedRecovery.consumedAction).toBe('continue');
    }
  );

  maybeDbTest(
    'public widget recovery start-new issues a fresh verified session without reusing the previous ticket',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-recovery-start-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Recovery Start Mailbox',
        emailAddress: 'widget-recovery-start-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widget = await createWidget({
        accessToken: owner.accessToken,
        name: 'Recovery Start Widget',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widget.status).toBe(200);

      const init = await initializePublicWidgetSession({
        publicKey: widget.body.widget.publicKey,
      });
      expect(init.status).toBe(200);

      const firstMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        email: 'widget-recovery-start@example.com',
        message: 'Original widget conversation.',
      });
      expect(firstMessage.status).toBe(200);

      const originalSession = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(init.body.session.token),
        deletedAt: null,
      }).lean();
      const supersededSession = await createWidgetSessionWithToken({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        sessionSeed: {
          contactId: originalSession.contactId,
          organizationId: originalSession.organizationId,
          ticketId: originalSession.ticketId,
          recoveryVerifiedAt: new Date(),
          recoveredFromSessionId: originalSession._id,
        },
      });

      const recoveryRequest = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widget.body.widget.publicKey,
          email: 'widget-recovery-start@example.com',
        })
      );
      const otpCode = extractOtpCodeFromLogs(recoveryRequest.logs);
      expect(otpCode).toBeTruthy();

      const verify = await verifyPublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        email: 'widget-recovery-start@example.com',
        code: otpCode,
      });
      expect(verify.status).toBe(200);

      const startedNew = await startNewPublicWidgetRecovery({
        publicKey: widget.body.widget.publicKey,
        recoveryToken: verify.body.recovery.token,
      });
      expect(startedNew.status).toBe(200);
      expect(startedNew.body.messageKey).toBe(
        'success.widget.recoveryStartedNew'
      );
      expect(startedNew.body.session.token).toMatch(/^wgs_[a-f0-9]{48}$/);
      expect(startedNew.body.session.token).not.toBe(init.body.session.token);
      expect(startedNew.body.session.recoveryVerified).toBe(true);
      expect(startedNew.body.conversation).toEqual({
        state: 'idle',
        ticketStatus: null,
        lastMessageAt: null,
        messageCount: 0,
        publicMessageCount: 0,
        messages: [],
      });

      const recoveredSession = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        publicSessionKeyHash: hashValue(startedNew.body.session.token),
        deletedAt: null,
      }).lean();
      expect(recoveredSession).toBeTruthy();
      expect(recoveredSession.ticketId).toBeNull();
      expect(String(recoveredSession.contactId)).toBe(
        String(originalSession.contactId)
      );

      const invalidatedOriginalSession = await WidgetSession.findById(
        originalSession._id
      ).lean();
      const invalidatedSupersededSession = await WidgetSession.findById(
        supersededSession.session._id
      ).lean();
      expect(invalidatedOriginalSession.invalidatedAt).toBeTruthy();
      expect(invalidatedOriginalSession.publicSessionKeyHash).toBeNull();
      expect(invalidatedSupersededSession.invalidatedAt).toBeTruthy();
      expect(invalidatedSupersededSession.publicSessionKeyHash).toBeNull();

      const newConversationMessage = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: startedNew.body.session.token,
        message: 'Fresh conversation after recovery.',
      });
      expect(newConversationMessage.status).toBe(200);
      expect(newConversationMessage.body.conversation.messageCount).toBe(1);

      const refreshedRecoveredSession = await WidgetSession.findById(
        recoveredSession._id
      ).lean();
      expect(String(refreshedRecoveredSession.ticketId)).not.toBe(
        String(originalSession.ticketId)
      );

      const originalTicket = await Ticket.findById(originalSession.ticketId).lean();
      const newTicket = await Ticket.findById(
        refreshedRecoveredSession.ticketId
      ).lean();
      expect(originalTicket.messageCount).toBe(1);
      expect(String(newTicket.contactId)).toBe(String(originalTicket.contactId));
      expect(String(newTicket.widgetSessionId)).toBe(String(recoveredSession._id));

      const staleMessageAttempt = await createPublicWidgetMessage({
        publicKey: widget.body.widget.publicKey,
        sessionToken: init.body.session.token,
        message: 'Original invalidated token should fail.',
      });
      expect(staleMessageAttempt.status).toBe(404);
      expect(staleMessageAttempt.body.messageKey).toBe(
        'errors.widget.sessionNotFound'
      );

      const consumedRecovery = await WidgetRecovery.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widget.body.widget._id,
        recoveryTokenHash: hashValue(verify.body.recovery.token),
      }).lean();
      expect(consumedRecovery.consumedAction).toBe('start_new');
    }
  );

  maybeDbTest(
    'public widget recovery stays widget-scoped and respects solved and closed eligibility rules',
    async () => {
      const owner = await createVerifiedUser({
        email: 'widget-recovery-scope-owner@example.com',
      });

      const mailbox = await createMailbox({
        accessToken: owner.accessToken,
        name: 'Recovery Scope Mailbox',
        emailAddress: 'widget-recovery-scope-mailbox@example.com',
      });
      expect(mailbox.status).toBe(200);

      const widgetA = await createWidget({
        accessToken: owner.accessToken,
        name: 'Recovery Scope Widget A',
        mailboxId: mailbox.body.mailbox._id,
      });
      const widgetB = await createWidget({
        accessToken: owner.accessToken,
        name: 'Recovery Scope Widget B',
        mailboxId: mailbox.body.mailbox._id,
      });
      expect(widgetA.status).toBe(200);
      expect(widgetB.status).toBe(200);

      const sessionA1 = await initializePublicWidgetSession({
        publicKey: widgetA.body.widget.publicKey,
      });
      const sessionA2 = await initializePublicWidgetSession({
        publicKey: widgetA.body.widget.publicKey,
      });
      const sessionB1 = await initializePublicWidgetSession({
        publicKey: widgetB.body.widget.publicKey,
      });

      await createPublicWidgetMessage({
        publicKey: widgetA.body.widget.publicKey,
        sessionToken: sessionA1.body.session.token,
        email: 'widget-recovery-scope@example.com',
        message: 'Older open conversation in widget A.',
      });
      await createPublicWidgetMessage({
        publicKey: widgetA.body.widget.publicKey,
        sessionToken: sessionA2.body.session.token,
        email: 'widget-recovery-scope@example.com',
        message: 'Latest solved conversation in widget A.',
      });
      await createPublicWidgetMessage({
        publicKey: widgetB.body.widget.publicKey,
        sessionToken: sessionB1.body.session.token,
        email: 'widget-recovery-scope@example.com',
        message: 'Conversation in widget B.',
      });

      const widgetASessions = await WidgetSession.find({
        workspaceId: owner.workspaceId,
        widgetId: widgetA.body.widget._id,
        deletedAt: null,
      })
        .sort({ createdAt: 1, _id: 1 })
        .lean();
      const widgetBSession = await WidgetSession.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widgetB.body.widget._id,
        deletedAt: null,
      }).lean();

      const openTicket = await Ticket.findById(widgetASessions[0].ticketId);
      const solvedTicket = await Ticket.findById(widgetASessions[1].ticketId);
      const widgetBTicket = await Ticket.findById(widgetBSession.ticketId);

      solvedTicket.status = TICKET_STATUS.SOLVED;
      solvedTicket.statusChangedAt = new Date();
      await solvedTicket.save();

      const requestA = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widgetA.body.widget.publicKey,
          email: 'widget-recovery-scope@example.com',
        })
      );
      const codeA = extractOtpCodeFromLogs(requestA.logs);
      expect(codeA).toBeTruthy();

      const wrongWidgetVerify = await verifyPublicWidgetRecovery({
        publicKey: widgetB.body.widget.publicKey,
        email: 'widget-recovery-scope@example.com',
        code: codeA,
      });
      expect(wrongWidgetVerify.status).toBe(422);
      expect(wrongWidgetVerify.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'code',
            messageKey: 'errors.otp.invalid',
          }),
        ])
      );

      const verifySolved = await verifyPublicWidgetRecovery({
        publicKey: widgetA.body.widget.publicKey,
        email: 'widget-recovery-scope@example.com',
        code: codeA,
      });
      expect(verifySolved.status).toBe(200);
      expect(verifySolved.body.recovery.candidate.ticketStatus).toBe(
        TICKET_STATUS.SOLVED
      );

      const solvedRecoveryRecord = await WidgetRecovery.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widgetA.body.widget._id,
        recoveryTokenHash: hashValue(verifySolved.body.recovery.token),
      }).lean();
      expect(String(solvedRecoveryRecord.candidateTicketId)).toBe(
        String(solvedTicket._id)
      );
      expect(String(solvedRecoveryRecord.candidateTicketId)).not.toBe(
        String(widgetBTicket._id)
      );

      solvedTicket.statusChangedAt = new Date(
        Date.now() - 96 * 60 * 60 * 1000
      );
      await solvedTicket.save();
      await OtpCode.updateMany(
        {
          emailNormalized: 'widget-recovery-scope@example.com',
          purpose: 'widgetRecovery',
        },
        {
          $set: {
            lastSentAt: new Date(Date.now() - 10 * 60 * 1000),
          },
        }
      );

      const requestAAgain = await captureFallbackEmail(() =>
        requestPublicWidgetRecovery({
          publicKey: widgetA.body.widget.publicKey,
          email: 'widget-recovery-scope@example.com',
        })
      );
      const codeAAgain = extractOtpCodeFromLogs(requestAAgain.logs);
      expect(codeAAgain).toBeTruthy();

      const verifyFallback = await verifyPublicWidgetRecovery({
        publicKey: widgetA.body.widget.publicKey,
        email: 'widget-recovery-scope@example.com',
        code: codeAAgain,
      });
      expect(verifyFallback.status).toBe(200);
      expect(verifyFallback.body.recovery.candidate.ticketStatus).toBe(
        TICKET_STATUS.OPEN
      );

      const fallbackRecoveryRecord = await WidgetRecovery.findOne({
        workspaceId: owner.workspaceId,
        widgetId: widgetA.body.widget._id,
        recoveryTokenHash: hashValue(verifyFallback.body.recovery.token),
      }).lean();
      expect(String(fallbackRecoveryRecord.candidateTicketId)).toBe(
        String(openTicket._id)
      );
    }
  );
});
