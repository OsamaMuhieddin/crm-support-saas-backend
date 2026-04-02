import request from 'supertest';
import app from '../src/app.js';
import { Mailbox } from '../src/modules/mailboxes/models/mailbox.model.js';
import { BusinessHours } from '../src/modules/sla/models/business-hours.model.js';
import { SlaPolicy } from '../src/modules/sla/models/sla-policy.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
import {
  captureFallbackEmail,
  extractInviteTokenFromLogs,
  extractOtpCodeFromLogs,
} from './helpers/email-capture.js';
import { setWorkspaceBillingPlanForTests } from './helpers/billing.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

const defaultWeeklySchedule = [
  {
    dayOfWeek: 1,
    isOpen: true,
    windows: [{ start: '09:00', end: '17:00' }],
  },
  {
    dayOfWeek: 2,
    isOpen: true,
    windows: [{ start: '09:00', end: '17:00' }],
  },
  {
    dayOfWeek: 3,
    isOpen: true,
    windows: [{ start: '09:00', end: '17:00' }],
  },
  {
    dayOfWeek: 4,
    isOpen: true,
    windows: [{ start: '09:00', end: '17:00' }],
  },
  {
    dayOfWeek: 5,
    isOpen: true,
    windows: [{ start: '09:00', end: '17:00' }],
  },
];

const defaultRulesByPriority = {
  low: {
    firstResponseMinutes: 120,
    resolutionMinutes: 480,
  },
  normal: {
    firstResponseMinutes: 60,
    resolutionMinutes: 240,
  },
  high: {
    firstResponseMinutes: 30,
    resolutionMinutes: 120,
  },
  urgent: {
    firstResponseMinutes: 15,
    resolutionMinutes: 60,
  },
};

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

  return {
    accessToken: switched.body.accessToken,
    email: member.email,
  };
};

const createBusinessHours = async ({
  accessToken,
  name = 'Cairo Support Hours',
  timezone = 'Asia/Damascus',
  weeklySchedule = defaultWeeklySchedule,
}) =>
  request(app)
    .post('/api/sla/business-hours')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      timezone,
      weeklySchedule,
    });

const createSlaPolicy = async ({
  accessToken,
  name = 'Default Support SLA',
  businessHoursId,
  rulesByPriority = defaultRulesByPriority,
}) =>
  request(app)
    .post('/api/sla/policies')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      name,
      businessHoursId,
      rulesByPriority,
    });

describe('SLA v1 foundations + management surface', () => {
  test('GET /api/sla/summary requires authentication', async () => {
    const response = await request(app).get('/api/sla/summary');

    expect(response.status).toBe(401);
    expect(response.body.messageKey).toBe('errors.auth.invalidToken');
  });

  maybeDbTest(
    'business hours endpoints support create/list/options/get/update and validation failures',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-business-hours-owner@example.com',
      });

      const invalidTimezone = await request(app)
        .post('/api/sla/business-hours')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Broken Hours',
          timezone: 'Mars/Base',
          weeklySchedule: defaultWeeklySchedule,
        });

      expect(invalidTimezone.status).toBe(422);
      expect(invalidTimezone.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'timezone',
            messageKey: 'errors.validation.invalidTimezone',
          }),
        ])
      );

      const createResponse = await createBusinessHours({
        accessToken: owner.accessToken,
      });

      expect(createResponse.status).toBe(200);
      expect(createResponse.body.messageKey).toBe(
        'success.sla.businessHours.created'
      );
      expect(createResponse.body.businessHours.weeklySchedule).toHaveLength(7);
      expect(createResponse.body.businessHours.weeklySchedule[0]).toEqual({
        dayOfWeek: 0,
        isOpen: false,
        windows: [],
      });

      const listResponse = await request(app)
        .get('/api/sla/business-hours')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(listResponse.status).toBe(200);
      expect(listResponse.body.total).toBe(1);
      expect(listResponse.body.businessHours[0]._id).toBe(
        createResponse.body.businessHours._id
      );

      const optionsResponse = await request(app)
        .get('/api/sla/business-hours/options')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(optionsResponse.status).toBe(200);
      expect(optionsResponse.body.options).toEqual([
        expect.objectContaining({
          _id: createResponse.body.businessHours._id,
          name: 'Cairo Support Hours',
        }),
      ]);

      const getResponse = await request(app)
        .get(`/api/sla/business-hours/${createResponse.body.businessHours._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(getResponse.status).toBe(200);
      expect(getResponse.body.businessHours.timezone).toBe('Asia/Damascus');

      const invalidPatch = await request(app)
        .patch(
          `/api/sla/business-hours/${createResponse.body.businessHours._id}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          weeklySchedule: [
            {
              dayOfWeek: 1,
              isOpen: true,
              windows: [
                { start: '09:00', end: '12:00' },
                { start: '11:00', end: '13:00' },
              ],
            },
          ],
        });

      expect(invalidPatch.status).toBe(422);
      expect(invalidPatch.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'weeklySchedule[0].windows',
            messageKey: 'errors.validation.invalidTime',
          }),
        ])
      );

      const updateResponse = await request(app)
        .patch(
          `/api/sla/business-hours/${createResponse.body.businessHours._id}`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Updated Support Hours',
          timezone: 'UTC',
          weeklySchedule: [
            {
              dayOfWeek: 0,
              isOpen: true,
              windows: [{ start: '10:00', end: '14:00' }],
            },
          ],
        });

      expect(updateResponse.status).toBe(200);
      expect(updateResponse.body.messageKey).toBe(
        'success.sla.businessHours.updated'
      );
      expect(updateResponse.body.businessHours.name).toBe(
        'Updated Support Hours'
      );
      expect(updateResponse.body.businessHours.timezone).toBe('UTC');
      expect(updateResponse.body.businessHours.weeklySchedule[0]).toEqual({
        dayOfWeek: 0,
        isOpen: true,
        windows: [{ start: '10:00', end: '14:00' }],
      });
      expect(updateResponse.body.businessHours.weeklySchedule[1]).toEqual({
        dayOfWeek: 1,
        isOpen: false,
        windows: [],
      });
    }
  );

  maybeDbTest(
    'policy endpoints support CRUD-ish flow, default assignment, mailbox assignment, and summary',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-policy-owner@example.com',
      });

      const businessHours = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Policy Support Hours',
      });
      expect(businessHours.status).toBe(200);

      const invalidPolicy = await request(app)
        .post('/api/sla/policies')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Broken SLA',
          businessHoursId: businessHours.body.businessHours._id,
          rulesByPriority: {
            high: {
              nextResponseMinutes: 45,
            },
          },
        });

      expect(invalidPolicy.status).toBe(422);
      expect(invalidPolicy.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'rulesByPriority.high.nextResponseMinutes',
            messageKey: 'errors.validation.unknownField',
          }),
          expect.objectContaining({
            field: 'rulesByPriority.low',
            messageKey: 'errors.validation.atLeastOneRuleRequired',
          }),
          expect.objectContaining({
            field: 'rulesByPriority.normal',
            messageKey: 'errors.validation.atLeastOneRuleRequired',
          }),
          expect.objectContaining({
            field: 'rulesByPriority.urgent',
            messageKey: 'errors.validation.atLeastOneRuleRequired',
          }),
        ])
      );

      const createPolicyResponse = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
      });

      expect(createPolicyResponse.status).toBe(200);
      expect(createPolicyResponse.body.messageKey).toBe(
        'success.sla.policy.created'
      );
      expect(createPolicyResponse.body.policy.isActive).toBe(true);
      expect(createPolicyResponse.body.policy.isDefault).toBe(false);

      const listPoliciesResponse = await request(app)
        .get('/api/sla/policies')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(listPoliciesResponse.status).toBe(200);
      expect(listPoliciesResponse.body.policies).toHaveLength(1);

      const optionsResponse = await request(app)
        .get('/api/sla/policies/options')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(optionsResponse.status).toBe(200);
      expect(optionsResponse.body.options[0]).toEqual(
        expect.objectContaining({
          _id: createPolicyResponse.body.policy._id,
          isActive: true,
          isDefault: false,
        })
      );

      const updatePolicyResponse = await request(app)
        .patch(`/api/sla/policies/${createPolicyResponse.body.policy._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Updated Support SLA',
          rulesByPriority: {
            urgent: {
              firstResponseMinutes: 10,
              resolutionMinutes: 45,
            },
          },
        });

      expect(updatePolicyResponse.status).toBe(200);
      expect(updatePolicyResponse.body.messageKey).toBe(
        'success.sla.policy.updated'
      );
      expect(updatePolicyResponse.body.policy.name).toBe('Updated Support SLA');
      expect(updatePolicyResponse.body.policy.rulesByPriority.high).toEqual({
        firstResponseMinutes: 30,
        resolutionMinutes: 120,
      });
      expect(updatePolicyResponse.body.policy.rulesByPriority.urgent).toEqual({
        firstResponseMinutes: 10,
        resolutionMinutes: 45,
      });

      const setDefaultResponse = await request(app)
        .post(
          `/api/sla/policies/${createPolicyResponse.body.policy._id}/set-default`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(setDefaultResponse.status).toBe(200);
      expect(setDefaultResponse.body.messageKey).toBe(
        'success.sla.policy.defaultSet'
      );
      expect(setDefaultResponse.body.policy.isDefault).toBe(true);
      expect(setDefaultResponse.body.policy.isActive).toBe(true);
      expect(setDefaultResponse.body.policy.name).toBe('Updated Support SLA');
      expect(setDefaultResponse.body.policy.rulesByPriority).toBeUndefined();

      const workspace = await Workspace.findById(owner.workspaceId).lean();
      const defaultPolicies = await SlaPolicy.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
        isDefault: true,
      })
        .select('_id')
        .lean();
      expect(String(workspace.defaultSlaPolicyId)).toBe(
        createPolicyResponse.body.policy._id
      );
      expect(defaultPolicies).toHaveLength(1);
      expect(String(defaultPolicies[0]._id)).toBe(
        createPolicyResponse.body.policy._id
      );

      const createMailboxWithoutSla = await request(app)
        .post('/api/mailboxes')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'No SLA Queue',
          emailAddress: 'no-sla@example.com',
        });

      expect(createMailboxWithoutSla.status).toBe(200);
      expect(createMailboxWithoutSla.body.mailbox.slaPolicyId).toBeNull();

      const patchMailboxWithoutSla = await request(app)
        .patch(`/api/mailboxes/${createMailboxWithoutSla.body.mailbox._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Still No SLA Queue',
        });

      expect(patchMailboxWithoutSla.status).toBe(200);
      expect(patchMailboxWithoutSla.body.mailbox.slaPolicyId).toBeNull();

      const setMailboxSla = await request(app)
        .patch(`/api/mailboxes/${createMailboxWithoutSla.body.mailbox._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          slaPolicyId: createPolicyResponse.body.policy._id,
        });

      expect(setMailboxSla.status).toBe(200);
      expect(setMailboxSla.body.mailbox.slaPolicyId).toBe(
        createPolicyResponse.body.policy._id
      );

      const summaryResponse = await request(app)
        .get('/api/sla/summary')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(summaryResponse.status).toBe(200);
      expect(summaryResponse.body.summary.businessHours.total).toBe(1);
      expect(summaryResponse.body.summary.policies.total).toBe(1);
      expect(summaryResponse.body.summary.policies.active).toBe(1);
      expect(summaryResponse.body.summary.policies.defaultPolicyId).toBe(
        createPolicyResponse.body.policy._id
      );
      expect(summaryResponse.body.summary.mailboxes.withOverrideCount).toBe(1);
      expect(
        summaryResponse.body.summary.runtime.ticketLifecycleIntegrated
      ).toBe(true);
    }
  );

  maybeDbTest(
    'policy update validates the merged final ruleset so one-priority patches stay allowed but legacy partial policies must be completed first',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-policy-merged-validation-owner@example.com',
      });

      const businessHours = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Merged Validation Hours',
      });
      expect(businessHours.status).toBe(200);

      const legacyPolicy = await SlaPolicy.create({
        workspaceId: owner.workspaceId,
        name: 'Legacy Partial Policy',
        businessHoursId: businessHours.body.businessHours._id,
        rulesByPriority: {
          high: {
            firstResponseMinutes: 30,
            resolutionMinutes: 120,
          },
        },
        isActive: true,
        isDefault: false,
      });

      const renameLegacyPolicy = await request(app)
        .patch(`/api/sla/policies/${legacyPolicy._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Legacy Partial Policy Renamed',
        });

      expect(renameLegacyPolicy.status).toBe(422);
      expect(renameLegacyPolicy.body.messageKey).toBe(
        'errors.validation.failed'
      );
      expect(renameLegacyPolicy.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'rulesByPriority.low',
            messageKey: 'errors.validation.atLeastOneRuleRequired',
          }),
          expect.objectContaining({
            field: 'rulesByPriority.normal',
            messageKey: 'errors.validation.atLeastOneRuleRequired',
          }),
          expect.objectContaining({
            field: 'rulesByPriority.urgent',
            messageKey: 'errors.validation.atLeastOneRuleRequired',
          }),
        ])
      );

      const completeLegacyPolicy = await request(app)
        .patch(`/api/sla/policies/${legacyPolicy._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          rulesByPriority: {
            low: {
              firstResponseMinutes: 120,
              resolutionMinutes: 480,
            },
            normal: {
              firstResponseMinutes: 60,
              resolutionMinutes: 240,
            },
            urgent: {
              firstResponseMinutes: 15,
              resolutionMinutes: 60,
            },
          },
        });

      expect(completeLegacyPolicy.status).toBe(200);
      expect(completeLegacyPolicy.body.policy.rulesByPriority.high).toEqual({
        firstResponseMinutes: 30,
        resolutionMinutes: 120,
      });
      expect(completeLegacyPolicy.body.policy.rulesByPriority.low).toEqual({
        firstResponseMinutes: 120,
        resolutionMinutes: 480,
      });
      expect(completeLegacyPolicy.body.policy.rulesByPriority.normal).toEqual({
        firstResponseMinutes: 60,
        resolutionMinutes: 240,
      });
      expect(completeLegacyPolicy.body.policy.rulesByPriority.urgent).toEqual({
        firstResponseMinutes: 15,
        resolutionMinutes: 60,
      });
    }
  );

  maybeDbTest(
    'policy activate/deactivate manages workspace and mailbox assignments while visibility stays role-aware',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-policy-visibility-owner@example.com',
      });

      const businessHours = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Visibility Hours',
      });
      expect(businessHours.status).toBe(200);

      const policy = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
        name: 'Visibility Policy',
      });
      expect(policy.status).toBe(200);

      const mailbox = await request(app)
        .post('/api/mailboxes')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Visibility Queue',
          emailAddress: 'visibility@example.com',
          slaPolicyId: policy.body.policy._id,
        });
      expect(mailbox.status).toBe(200);

      const setDefault = await request(app)
        .post(`/api/sla/policies/${policy.body.policy._id}/set-default`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(setDefault.status).toBe(200);

      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'sla-policy-visibility-admin@example.com',
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'sla-policy-visibility-agent@example.com',
      });

      const deactivateResponse = await request(app)
        .post(`/api/sla/policies/${policy.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivateResponse.status).toBe(200);
      expect(deactivateResponse.body.messageKey).toBe(
        'success.sla.policy.deactivated'
      );
      expect(deactivateResponse.body.policy.isActive).toBe(false);
      expect(deactivateResponse.body.policy.name).toBe(policy.body.policy.name);
      expect(deactivateResponse.body.policy.businessHours).toBeUndefined();
      expect(deactivateResponse.body.deactivationImpact).toEqual({
        clearedWorkspaceDefault: true,
        clearedMailboxOverridesCount: 1,
        replacementPolicyId: null,
        replacementPolicyName: null,
        requiresDefaultReplacement: true,
      });

      const workspaceAfterDeactivate = await Workspace.findById(
        owner.workspaceId
      ).lean();
      const mailboxAfterDeactivate = await Mailbox.findById(
        mailbox.body.mailbox._id
      ).lean();

      expect(workspaceAfterDeactivate.defaultSlaPolicyId).toBeNull();
      expect(mailboxAfterDeactivate.slaPolicyId).toBeNull();

      const agentGetInactive = await request(app)
        .get(`/api/sla/policies/${policy.body.policy._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);

      expect(agentGetInactive.status).toBe(404);
      expect(agentGetInactive.body.messageKey).toBe(
        'errors.sla.policyNotFound'
      );

      const adminGetInactive = await request(app)
        .get(`/api/sla/policies/${policy.body.policy._id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(adminGetInactive.status).toBe(200);
      expect(adminGetInactive.body.policy.isActive).toBe(false);

      const agentIncludeInactive = await request(app)
        .get('/api/sla/policies?includeInactive=true')
        .set('Authorization', `Bearer ${agent.accessToken}`);

      expect(agentIncludeInactive.status).toBe(403);
      expect(agentIncludeInactive.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );

      const adminIncludeInactive = await request(app)
        .get('/api/sla/policies?includeInactive=true')
        .set('Authorization', `Bearer ${admin.accessToken}`);

      expect(adminIncludeInactive.status).toBe(200);
      expect(adminIncludeInactive.body.policies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: policy.body.policy._id,
            isActive: false,
          }),
        ])
      );

      const activateResponse = await request(app)
        .post(`/api/sla/policies/${policy.body.policy._id}/activate`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({});

      expect(activateResponse.status).toBe(200);
      expect(activateResponse.body.messageKey).toBe(
        'success.sla.policy.activated'
      );
      expect(activateResponse.body.policy.isActive).toBe(true);
      expect(activateResponse.body.policy.name).toBe(policy.body.policy.name);
      expect(activateResponse.body.policy.rulesByPriority).toBeUndefined();

      const agentGetActive = await request(app)
        .get(`/api/sla/policies/${policy.body.policy._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);

      expect(agentGetActive.status).toBe(200);
      expect(agentGetActive.body.policy.isActive).toBe(true);
    }
  );

  maybeDbTest(
    'policy deactivate can swap the workspace default to an active replacement while still clearing mailbox overrides',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-policy-replacement-owner@example.com',
      });

      const businessHours = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Replacement Hours',
      });
      expect(businessHours.status).toBe(200);

      const primaryPolicy = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
        name: 'Primary Policy',
      });
      const replacementPolicy = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
        name: 'Replacement Policy',
      });

      expect(primaryPolicy.status).toBe(200);
      expect(replacementPolicy.status).toBe(200);

      const mailbox = await request(app)
        .post('/api/mailboxes')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Replacement Queue',
          emailAddress: 'replacement-queue@example.com',
          slaPolicyId: primaryPolicy.body.policy._id,
        });
      expect(mailbox.status).toBe(200);

      const setDefault = await request(app)
        .post(`/api/sla/policies/${primaryPolicy.body.policy._id}/set-default`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(setDefault.status).toBe(200);

      const deactivateWithReplacement = await request(app)
        .post(`/api/sla/policies/${primaryPolicy.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          replacementPolicyId: replacementPolicy.body.policy._id,
        });

      expect(deactivateWithReplacement.status).toBe(200);
      expect(deactivateWithReplacement.body.policy.isActive).toBe(false);
      expect(deactivateWithReplacement.body.policy.name).toBe(
        primaryPolicy.body.policy.name
      );
      expect(deactivateWithReplacement.body.deactivationImpact).toEqual({
        clearedWorkspaceDefault: false,
        clearedMailboxOverridesCount: 1,
        replacementPolicyId: replacementPolicy.body.policy._id,
        replacementPolicyName: replacementPolicy.body.policy.name,
        requiresDefaultReplacement: false,
      });

      const workspaceAfterDeactivate = await Workspace.findById(
        owner.workspaceId
      ).lean();
      const mailboxAfterDeactivate = await Mailbox.findById(
        mailbox.body.mailbox._id
      ).lean();
      const primaryPolicyAfterDeactivate = await SlaPolicy.findById(
        primaryPolicy.body.policy._id
      ).lean();
      const replacementPolicyAfterDeactivate = await SlaPolicy.findById(
        replacementPolicy.body.policy._id
      ).lean();
      const summaryAfterDeactivate = await request(app)
        .get('/api/sla/summary')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(String(workspaceAfterDeactivate.defaultSlaPolicyId)).toBe(
        replacementPolicy.body.policy._id
      );
      expect(mailboxAfterDeactivate.slaPolicyId).toBeNull();
      expect(primaryPolicyAfterDeactivate.isDefault).toBe(false);
      expect(replacementPolicyAfterDeactivate.isDefault).toBe(true);
      expect(replacementPolicyAfterDeactivate.isActive).toBe(true);
      expect(summaryAfterDeactivate.status).toBe(200);
      expect(summaryAfterDeactivate.body.summary.policies.defaultPolicyId).toBe(
        replacementPolicy.body.policy._id
      );
    }
  );

  maybeDbTest(
    'policy deactivation repairs an already-inactive default pointer with and without replacement',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-policy-stale-default-owner@example.com',
      });

      const businessHours = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Stale Default Hours',
      });
      expect(businessHours.status).toBe(200);

      const primaryPolicy = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
        name: 'Stale Default Policy',
      });
      const replacementPolicy = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
        name: 'Fresh Default Policy',
      });

      expect(primaryPolicy.status).toBe(200);
      expect(replacementPolicy.status).toBe(200);

      const setDefault = await request(app)
        .post(`/api/sla/policies/${primaryPolicy.body.policy._id}/set-default`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(setDefault.status).toBe(200);

      await SlaPolicy.updateOne(
        { _id: primaryPolicy.body.policy._id },
        {
          $set: {
            isActive: false,
            isDefault: false,
          },
        }
      );

      const deactivateWithReplacement = await request(app)
        .post(`/api/sla/policies/${primaryPolicy.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          replacementPolicyId: replacementPolicy.body.policy._id,
        });

      expect(deactivateWithReplacement.status).toBe(200);
      expect(deactivateWithReplacement.body.deactivationImpact).toEqual({
        clearedWorkspaceDefault: false,
        clearedMailboxOverridesCount: 0,
        replacementPolicyId: replacementPolicy.body.policy._id,
        replacementPolicyName: replacementPolicy.body.policy.name,
        requiresDefaultReplacement: false,
      });

      const workspaceAfterReplacement = await Workspace.findById(
        owner.workspaceId
      ).lean();
      const primaryAfterReplacement = await SlaPolicy.findById(
        primaryPolicy.body.policy._id
      ).lean();
      const replacementAfterReplacement = await SlaPolicy.findById(
        replacementPolicy.body.policy._id
      ).lean();

      expect(String(workspaceAfterReplacement.defaultSlaPolicyId)).toBe(
        replacementPolicy.body.policy._id
      );
      expect(primaryAfterReplacement.isDefault).toBe(false);
      expect(primaryAfterReplacement.isActive).toBe(false);
      expect(replacementAfterReplacement.isDefault).toBe(true);
      expect(replacementAfterReplacement.isActive).toBe(true);

      await Workspace.updateOne(
        { _id: owner.workspaceId },
        {
          $set: {
            defaultSlaPolicyId: primaryPolicy.body.policy._id,
          },
        }
      );
      await SlaPolicy.updateMany(
        { workspaceId: owner.workspaceId },
        {
          $set: {
            isDefault: true,
          },
        }
      );
      await SlaPolicy.updateOne(
        { _id: primaryPolicy.body.policy._id },
        {
          $set: {
            isActive: false,
          },
        }
      );

      const deactivateWithoutReplacement = await request(app)
        .post(`/api/sla/policies/${primaryPolicy.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivateWithoutReplacement.status).toBe(200);
      expect(deactivateWithoutReplacement.body.deactivationImpact).toEqual({
        clearedWorkspaceDefault: true,
        clearedMailboxOverridesCount: 0,
        replacementPolicyId: null,
        replacementPolicyName: null,
        requiresDefaultReplacement: true,
      });

      const workspaceAfterClear = await Workspace.findById(
        owner.workspaceId
      ).lean();
      const policiesAfterClear = await SlaPolicy.find({
        workspaceId: owner.workspaceId,
        deletedAt: null,
      })
        .select('_id isDefault')
        .lean();

      expect(workspaceAfterClear.defaultSlaPolicyId).toBeNull();
      expect(policiesAfterClear.every((policy) => policy.isDefault === false)).toBe(
        true
      );
    }
  );

  maybeDbTest(
    'mailbox SLA assignment enforces active same-workspace policies and non-admin roles cannot mutate SLA resources',
    async () => {
      const ownerA = await createVerifiedUser({
        email: 'sla-mailbox-owner-a@example.com',
      });
      const ownerB = await createVerifiedUser({
        email: 'sla-mailbox-owner-b@example.com',
      });

      const businessHoursA = await createBusinessHours({
        accessToken: ownerA.accessToken,
        name: 'Owner A Hours',
      });
      const policyA = await createSlaPolicy({
        accessToken: ownerA.accessToken,
        businessHoursId: businessHoursA.body.businessHours._id,
        name: 'Owner A Policy',
      });

      const businessHoursB = await createBusinessHours({
        accessToken: ownerB.accessToken,
        name: 'Owner B Hours',
      });
      const policyB = await createSlaPolicy({
        accessToken: ownerB.accessToken,
        businessHoursId: businessHoursB.body.businessHours._id,
        name: 'Owner B Policy',
      });

      const foreignPolicyMailbox = await request(app)
        .post('/api/mailboxes')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Foreign Policy Queue',
          emailAddress: 'foreign-policy@example.com',
          slaPolicyId: policyB.body.policy._id,
        });

      expect(foreignPolicyMailbox.status).toBe(404);
      expect(foreignPolicyMailbox.body.messageKey).toBe(
        'errors.sla.policyNotFound'
      );

      const deactivatePolicy = await request(app)
        .post(`/api/sla/policies/${policyA.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({});
      expect(deactivatePolicy.status).toBe(200);

      const inactivePolicyMailbox = await request(app)
        .post('/api/mailboxes')
        .set('Authorization', `Bearer ${ownerA.accessToken}`)
        .send({
          name: 'Inactive Policy Queue',
          emailAddress: 'inactive-policy@example.com',
          slaPolicyId: policyA.body.policy._id,
        });

      expect(inactivePolicyMailbox.status).toBe(409);
      expect(inactivePolicyMailbox.body.messageKey).toBe(
        'errors.sla.policyInactive'
      );

      const invalidReplacement = await request(app)
        .post(`/api/sla/policies/${policyB.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({
          replacementPolicyId: policyB.body.policy._id,
        });

      expect(invalidReplacement.status).toBe(422);
      expect(invalidReplacement.body.messageKey).toBe(
        'errors.validation.failed'
      );
      expect(invalidReplacement.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'replacementPolicyId',
            messageKey: 'errors.sla.replacementPolicyMustDiffer',
          }),
        ])
      );

      const invalidReplacementId = await request(app)
        .post(`/api/sla/policies/${policyB.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({
          replacementPolicyId: 'not-a-valid-id',
        });

      expect(invalidReplacementId.status).toBe(422);
      expect(invalidReplacementId.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'replacementPolicyId',
            messageKey: 'errors.validation.invalidId',
          }),
        ])
      );

      const unknownDeactivateField = await request(app)
        .post(`/api/sla/policies/${policyB.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({
          replacementPolicyId: policyA.body.policy._id,
          force: true,
        });

      expect(unknownDeactivateField.status).toBe(422);
      expect(unknownDeactivateField.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'force',
            messageKey: 'errors.validation.unknownField',
          }),
        ])
      );

      const inactiveReplacementPolicy = await createSlaPolicy({
        accessToken: ownerB.accessToken,
        businessHoursId: businessHoursB.body.businessHours._id,
        name: 'Inactive Replacement Policy',
      });
      expect(inactiveReplacementPolicy.status).toBe(200);

      const deactivateInactiveReplacement = await request(app)
        .post(
          `/api/sla/policies/${inactiveReplacementPolicy.body.policy._id}/deactivate`
        )
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({});
      expect(deactivateInactiveReplacement.status).toBe(200);

      const inactiveReplacementUsage = await request(app)
        .post(`/api/sla/policies/${policyB.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({
          replacementPolicyId: inactiveReplacementPolicy.body.policy._id,
        });

      expect(inactiveReplacementUsage.status).toBe(409);
      expect(inactiveReplacementUsage.body.messageKey).toBe(
        'errors.sla.policyInactive'
      );

      const foreignReplacementUsage = await request(app)
        .post(`/api/sla/policies/${policyB.body.policy._id}/deactivate`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`)
        .send({
          replacementPolicyId: policyA.body.policy._id,
        });

      expect(foreignReplacementUsage.status).toBe(404);
      expect(foreignReplacementUsage.body.messageKey).toBe(
        'errors.sla.policyNotFound'
      );

      await SlaPolicy.updateOne(
        { _id: policyB.body.policy._id },
        {
          $set: {
            businessHoursId: businessHoursA.body.businessHours._id,
          },
        }
      );

      const getPolicyAfterForeignBusinessHoursDrift = await request(app)
        .get(`/api/sla/policies/${policyB.body.policy._id}`)
        .set('Authorization', `Bearer ${ownerB.accessToken}`);

      expect(getPolicyAfterForeignBusinessHoursDrift.status).toBe(200);
      expect(
        getPolicyAfterForeignBusinessHoursDrift.body.policy.businessHours
      ).toBeNull();

      const agent = await createWorkspaceScopedTokenForRole({
        owner: ownerA,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'sla-mailbox-agent@example.com',
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner: ownerA,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'sla-mailbox-viewer@example.com',
      });

      const agentCreateBusinessHours = await createBusinessHours({
        accessToken: agent.accessToken,
        name: 'Agent Hours',
      });
      expect(agentCreateBusinessHours.status).toBe(403);
      expect(agentCreateBusinessHours.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const viewerCreatePolicy = await request(app)
        .post('/api/sla/policies')
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({
          name: 'Viewer Policy',
          businessHoursId: businessHoursA.body.businessHours._id,
          rulesByPriority: defaultRulesByPriority,
        });
      expect(viewerCreatePolicy.status).toBe(403);
      expect(viewerCreatePolicy.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );

      const viewerSetDefault = await request(app)
        .post(`/api/sla/policies/${policyA.body.policy._id}/set-default`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({});
      expect(viewerSetDefault.status).toBe(403);
      expect(viewerSetDefault.body.messageKey).toBe(
        'errors.auth.forbiddenRole'
      );
    }
  );

  maybeDbTest(
    'SLA writes are blocked when the workspace plan no longer includes SLA while historical reads remain available',
    async () => {
      const owner = await createVerifiedUser({
        email: 'sla-plan-gated-owner@example.com',
      });

      const businessHours = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Legacy SLA Hours',
      });
      expect(businessHours.status).toBe(200);

      const policy = await createSlaPolicy({
        accessToken: owner.accessToken,
        businessHoursId: businessHours.body.businessHours._id,
        name: 'Legacy SLA Policy',
      });
      expect(policy.status).toBe(200);

      const mailbox = await request(app)
        .post('/api/mailboxes')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Legacy SLA Queue',
          emailAddress: 'legacy-sla-queue@example.com',
          slaPolicyId: policy.body.policy._id,
        });
      expect(mailbox.status).toBe(200);

      await setWorkspaceBillingPlanForTests({
        workspaceId: owner.workspaceId,
        planKey: 'starter',
      });

      const createBusinessHoursBlocked = await createBusinessHours({
        accessToken: owner.accessToken,
        name: 'Blocked Hours',
      });
      expect(createBusinessHoursBlocked.status).toBe(409);
      expect(createBusinessHoursBlocked.body.messageKey).toBe(
        'errors.billing.slaNotIncluded'
      );

      const updateBusinessHoursBlocked = await request(app)
        .patch(`/api/sla/business-hours/${businessHours.body.businessHours._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Blocked Update',
        });
      expect(updateBusinessHoursBlocked.status).toBe(409);
      expect(updateBusinessHoursBlocked.body.messageKey).toBe(
        'errors.billing.slaNotIncluded'
      );

      const createPolicyBlocked = await request(app)
        .post('/api/sla/policies')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Blocked Policy',
          businessHoursId: businessHours.body.businessHours._id,
          rulesByPriority: defaultRulesByPriority,
        });
      expect(createPolicyBlocked.status).toBe(409);
      expect(createPolicyBlocked.body.messageKey).toBe(
        'errors.billing.slaNotIncluded'
      );

      const updatePolicyBlocked = await request(app)
        .patch(`/api/sla/policies/${policy.body.policy._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Blocked Policy Update',
        });
      expect(updatePolicyBlocked.status).toBe(409);
      expect(updatePolicyBlocked.body.messageKey).toBe(
        'errors.billing.slaNotIncluded'
      );

      const setDefaultBlocked = await request(app)
        .post(`/api/sla/policies/${policy.body.policy._id}/set-default`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(setDefaultBlocked.status).toBe(409);
      expect(setDefaultBlocked.body.messageKey).toBe(
        'errors.billing.slaNotIncluded'
      );

      const mailboxAssignmentBlocked = await request(app)
        .patch(`/api/mailboxes/${mailbox.body.mailbox._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          slaPolicyId: policy.body.policy._id,
        });
      expect(mailboxAssignmentBlocked.status).toBe(409);
      expect(mailboxAssignmentBlocked.body.messageKey).toBe(
        'errors.billing.slaNotIncluded'
      );

      const policyRead = await request(app)
        .get(`/api/sla/policies/${policy.body.policy._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(policyRead.status).toBe(200);
      expect(policyRead.body.policy._id).toBe(policy.body.policy._id);

      const summaryRead = await request(app)
        .get('/api/sla/summary')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(summaryRead.status).toBe(200);
    }
  );
});
