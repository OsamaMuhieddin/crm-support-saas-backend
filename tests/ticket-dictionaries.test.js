import request from 'supertest';
import app from '../src/app.js';
import { WORKSPACE_ROLES } from '../src/constants/workspace-roles.js';
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

const createCategory = async ({ accessToken, name, slug, parentId, order }) => {
  const body = { name };

  if (slug !== undefined) {
    body.slug = slug;
  }

  if (parentId !== undefined) {
    body.parentId = parentId;
  }

  if (order !== undefined) {
    body.order = order;
  }

  return request(app)
    .post('/api/tickets/categories')
    .set('Authorization', `Bearer ${accessToken}`)
    .send(body);
};

const createTag = async ({ accessToken, name }) =>
  request(app)
    .post('/api/tickets/tags')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name });

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

describe('Ticket dictionaries endpoints', () => {
  maybeDbTest(
    'owner/admin can create categories, nested categories, list, options, and detail',
    async () => {
      const owner = await createVerifiedUser({
        email: 'ticket-categories-owner@example.com',
      });
      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'ticket-categories-admin@example.com',
      });

      const root = await createCategory({
        accessToken: owner.accessToken,
        name: 'Customer Care',
        order: 10,
      });

      expect(root.status).toBe(200);
      expect(root.body.messageKey).toBe('success.ticketCategory.created');
      expect(root.body.category.slug).toBe('customer-care');
      expect(root.body.category.path).toBe('customer-care');

      const child = await createCategory({
        accessToken: admin.accessToken,
        name: 'Refund Requests',
        parentId: root.body.category._id,
      });

      expect(child.status).toBe(200);
      expect(child.body.category.parentId).toBe(root.body.category._id);
      expect(child.body.category.path).toBe('customer-care/refund-requests');

      const list = await request(app)
        .get('/api/tickets/categories?page=1&limit=10&sort=name')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(list.status).toBe(200);
      expect(list.body.page).toBe(1);
      expect(list.body.limit).toBe(10);
      expect(list.body.total).toBe(2);
      expect(list.body.results).toBe(2);
      expect(list.body.categories.map((category) => category._id)).toEqual(
        expect.arrayContaining([
          root.body.category._id,
          child.body.category._id,
        ])
      );

      const filteredList = await request(app)
        .get(`/api/tickets/categories?parentId=${root.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(filteredList.status).toBe(200);
      expect(filteredList.body.categories).toHaveLength(1);
      expect(filteredList.body.categories[0]._id).toBe(child.body.category._id);

      const search = await request(app)
        .get('/api/tickets/categories?q=refund')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(search.status).toBe(200);
      expect(search.body.categories).toHaveLength(1);
      expect(search.body.categories[0]._id).toBe(child.body.category._id);

      const options = await request(app)
        .get('/api/tickets/categories/options?search=customer')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(options.status).toBe(200);
      expect(options.body.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: root.body.category._id,
            name: 'Customer Care',
            path: 'customer-care',
          }),
        ])
      );

      const detail = await request(app)
        .get(`/api/tickets/categories/${child.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body.category._id).toBe(child.body.category._id);
      expect(detail.body.category.parentId).toBe(root.body.category._id);
    }
  );

  maybeDbTest(
    'category updates recalculate paths and activate/deactivate is idempotent',
    async () => {
      const owner = await createVerifiedUser({
        email: 'ticket-categories-update-owner@example.com',
      });

      const root = await createCategory({
        accessToken: owner.accessToken,
        name: 'Support',
      });
      const child = await createCategory({
        accessToken: owner.accessToken,
        name: 'Billing',
        parentId: root.body.category._id,
      });

      const update = await request(app)
        .patch(`/api/tickets/categories/${root.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          slug: 'customer-success',
          order: 2,
        });

      expect(update.status).toBe(200);
      expect(update.body.messageKey).toBe('success.ticketCategory.updated');
      expect(update.body.category.slug).toBe('customer-success');
      expect(update.body.category.path).toBe('customer-success');
      expect(update.body.category.order).toBe(2);

      const childDetail = await request(app)
        .get(`/api/tickets/categories/${child.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(childDetail.status).toBe(200);
      expect(childDetail.body.category.path).toBe('customer-success/billing');

      const deactivate = await request(app)
        .post(`/api/tickets/categories/${root.body.category._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivate.status).toBe(200);
      expect(deactivate.body.messageKey).toBe(
        'success.ticketCategory.deactivated'
      );
      expect(deactivate.body.category.isActive).toBe(false);

      const deactivateAgain = await request(app)
        .post(`/api/tickets/categories/${root.body.category._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivateAgain.status).toBe(200);
      expect(deactivateAgain.body.category.isActive).toBe(false);

      const activate = await request(app)
        .post(`/api/tickets/categories/${root.body.category._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(activate.status).toBe(200);
      expect(activate.body.messageKey).toBe('success.ticketCategory.activated');
      expect(activate.body.category.isActive).toBe(true);

      const activateAgain = await request(app)
        .post(`/api/tickets/categories/${root.body.category._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(activateAgain.status).toBe(200);
      expect(activateAgain.body.category.isActive).toBe(true);
    }
  );

  maybeDbTest(
    'category mutation RBAC, validation, anti-enumeration, and inactive visibility are enforced',
    async () => {
      const owner = await createVerifiedUser({
        email: 'ticket-categories-rbac-owner@example.com',
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'ticket-categories-rbac-agent@example.com',
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'ticket-categories-rbac-viewer@example.com',
      });
      const otherOwner = await createVerifiedUser({
        email: 'ticket-categories-rbac-other-owner@example.com',
      });

      const category = await createCategory({
        accessToken: owner.accessToken,
        name: 'Internal',
      });

      expect(category.status).toBe(200);

      const agentCreate = await createCategory({
        accessToken: agent.accessToken,
        name: 'Should Fail',
      });
      expect(agentCreate.status).toBe(403);
      expect(agentCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

      const viewerPatch = await request(app)
        .patch(`/api/tickets/categories/${category.body.category._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ name: 'Should Fail' });
      expect(viewerPatch.status).toBe(403);
      expect(viewerPatch.body.messageKey).toBe('errors.auth.forbiddenRole');

      const invalidId = await request(app)
        .get('/api/tickets/categories/not-a-valid-id')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(invalidId, 'id', 'errors.validation.invalidId');

      const deactivate = await request(app)
        .post(
          `/api/tickets/categories/${category.body.category._id}/deactivate`
        )
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivate.status).toBe(200);

      const agentGetInactive = await request(app)
        .get(`/api/tickets/categories/${category.body.category._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentGetInactive.status).toBe(404);
      expect(agentGetInactive.body.messageKey).toBe(
        'errors.ticketCategory.notFound'
      );

      const otherWorkspaceGet = await request(app)
        .get(`/api/tickets/categories/${category.body.category._id}`)
        .set('Authorization', `Bearer ${otherOwner.accessToken}`);
      expect(otherWorkspaceGet.status).toBe(404);
      expect(otherWorkspaceGet.body.messageKey).toBe(
        'errors.ticketCategory.notFound'
      );

      const agentIncludeInactive = await request(app)
        .get('/api/tickets/categories?includeInactive=true')
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentIncludeInactive.status).toBe(403);
      expect(agentIncludeInactive.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );

      const agentInactiveOptions = await request(app)
        .get('/api/tickets/categories/options?includeInactive=true')
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentInactiveOptions.status).toBe(403);
      expect(agentInactiveOptions.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );

      const categoryActionUnexpectedBody = await request(app)
        .post(`/api/tickets/categories/${category.body.category._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ force: true });
      expectValidationError(
        categoryActionUnexpectedBody,
        'force',
        'errors.validation.unknownField'
      );

      const ownerOptionsDefault = await request(app)
        .get('/api/tickets/categories/options')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerOptionsDefault.status).toBe(200);
      expect(
        ownerOptionsDefault.body.options.some(
          (option) => option._id === category.body.category._id
        )
      ).toBe(false);

      const ownerListWithInactive = await request(app)
        .get('/api/tickets/categories?includeInactive=true')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerListWithInactive.status).toBe(200);
      expect(
        ownerListWithInactive.body.categories.some(
          (item) => item._id === category.body.category._id
        )
      ).toBe(true);

      const unknownFieldPatch = await request(app)
        .patch(`/api/tickets/categories/${category.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Renamed',
          unknownField: 'not-allowed',
        });
      expectValidationError(
        unknownFieldPatch,
        'unknownField',
        'errors.validation.unknownField'
      );

      const emptyPatch = await request(app)
        .patch(`/api/tickets/categories/${category.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expectValidationError(
        emptyPatch,
        'body',
        'errors.validation.bodyRequiresAtLeastOneField'
      );
    }
  );

  maybeDbTest(
    'categories reject duplicate slugs, self-parenting, and ancestry cycles',
    async () => {
      const owner = await createVerifiedUser({
        email: 'ticket-categories-conflicts-owner@example.com',
      });

      const root = await createCategory({
        accessToken: owner.accessToken,
        name: 'Billing',
      });
      expect(root.status).toBe(200);

      const duplicateSlug = await createCategory({
        accessToken: owner.accessToken,
        name: 'Duplicate',
        slug: 'billing',
      });
      expect(duplicateSlug.status).toBe(409);
      expect(duplicateSlug.body.messageKey).toBe(
        'errors.ticketCategory.slugAlreadyUsed'
      );

      const selfParent = await request(app)
        .patch(`/api/tickets/categories/${root.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ parentId: root.body.category._id });
      expectValidationError(
        selfParent,
        'parentId',
        'errors.ticketCategory.parentCannotBeSelf'
      );

      const child = await createCategory({
        accessToken: owner.accessToken,
        name: 'Invoices',
        parentId: root.body.category._id,
      });
      expect(child.status).toBe(200);

      const cycle = await request(app)
        .patch(`/api/tickets/categories/${root.body.category._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ parentId: child.body.category._id });
      expectValidationError(
        cycle,
        'parentId',
        'errors.ticketCategory.parentCycle'
      );
    }
  );

  maybeDbTest(
    'owner/admin can create tags, list, options, detail, update, and activate/deactivate',
    async () => {
      const owner = await createVerifiedUser({
        email: 'ticket-tags-owner@example.com',
      });
      const admin = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.ADMIN,
        email: 'ticket-tags-admin@example.com',
      });

      const vip = await createTag({
        accessToken: owner.accessToken,
        name: 'VIP',
      });

      expect(vip.status).toBe(200);
      expect(vip.body.messageKey).toBe('success.ticketTag.created');
      expect(vip.body.tag.name).toBe('VIP');

      const urgent = await createTag({
        accessToken: admin.accessToken,
        name: 'Urgent',
      });

      expect(urgent.status).toBe(200);

      const list = await request(app)
        .get('/api/tickets/tags?page=1&limit=10&sort=name')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(list.status).toBe(200);
      expect(list.body.page).toBe(1);
      expect(list.body.limit).toBe(10);
      expect(list.body.total).toBe(2);
      expect(list.body.tags.map((tag) => tag._id)).toEqual(
        expect.arrayContaining([vip.body.tag._id, urgent.body.tag._id])
      );

      const search = await request(app)
        .get('/api/tickets/tags?q=vip')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(search.status).toBe(200);
      expect(search.body.tags).toHaveLength(1);
      expect(search.body.tags[0]._id).toBe(vip.body.tag._id);

      const options = await request(app)
        .get('/api/tickets/tags/options')
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(options.status).toBe(200);
      expect(options.body.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _id: vip.body.tag._id,
            name: 'VIP',
          }),
        ])
      );

      const detail = await request(app)
        .get(`/api/tickets/tags/${vip.body.tag._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(detail.status).toBe(200);
      expect(detail.body.tag._id).toBe(vip.body.tag._id);

      const update = await request(app)
        .patch(`/api/tickets/tags/${vip.body.tag._id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ name: 'Priority VIP' });

      expect(update.status).toBe(200);
      expect(update.body.messageKey).toBe('success.ticketTag.updated');
      expect(update.body.tag.name).toBe('Priority VIP');

      const deactivate = await request(app)
        .post(`/api/tickets/tags/${vip.body.tag._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivate.status).toBe(200);
      expect(deactivate.body.messageKey).toBe('success.ticketTag.deactivated');
      expect(deactivate.body.tag.isActive).toBe(false);

      const deactivateAgain = await request(app)
        .post(`/api/tickets/tags/${vip.body.tag._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(deactivateAgain.status).toBe(200);
      expect(deactivateAgain.body.tag.isActive).toBe(false);

      const activate = await request(app)
        .post(`/api/tickets/tags/${vip.body.tag._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(activate.status).toBe(200);
      expect(activate.body.messageKey).toBe('success.ticketTag.activated');
      expect(activate.body.tag.isActive).toBe(true);

      const activateAgain = await request(app)
        .post(`/api/tickets/tags/${vip.body.tag._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});

      expect(activateAgain.status).toBe(200);
      expect(activateAgain.body.tag.isActive).toBe(true);
    }
  );

  maybeDbTest(
    'tag mutation RBAC, validation, anti-enumeration, and inactive visibility are enforced',
    async () => {
      const owner = await createVerifiedUser({
        email: 'ticket-tags-rbac-owner@example.com',
      });
      const agent = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.AGENT,
        email: 'ticket-tags-rbac-agent@example.com',
      });
      const viewer = await createWorkspaceScopedTokenForRole({
        owner,
        roleKey: WORKSPACE_ROLES.VIEWER,
        email: 'ticket-tags-rbac-viewer@example.com',
      });
      const otherOwner = await createVerifiedUser({
        email: 'ticket-tags-rbac-other-owner@example.com',
      });

      const tag = await createTag({
        accessToken: owner.accessToken,
        name: 'Internal Tag',
      });
      expect(tag.status).toBe(200);

      const agentCreate = await createTag({
        accessToken: agent.accessToken,
        name: 'Should Fail',
      });
      expect(agentCreate.status).toBe(403);
      expect(agentCreate.body.messageKey).toBe('errors.auth.forbiddenRole');

      const viewerPatch = await request(app)
        .patch(`/api/tickets/tags/${tag.body.tag._id}`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send({ name: 'Should Fail' });
      expect(viewerPatch.status).toBe(403);
      expect(viewerPatch.body.messageKey).toBe('errors.auth.forbiddenRole');

      const invalidId = await request(app)
        .get('/api/tickets/tags/not-a-valid-id')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expectValidationError(invalidId, 'id', 'errors.validation.invalidId');

      const deactivate = await request(app)
        .post(`/api/tickets/tags/${tag.body.tag._id}/deactivate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expect(deactivate.status).toBe(200);

      const agentGetInactive = await request(app)
        .get(`/api/tickets/tags/${tag.body.tag._id}`)
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentGetInactive.status).toBe(404);
      expect(agentGetInactive.body.messageKey).toBe(
        'errors.ticketTag.notFound'
      );

      const otherWorkspaceGet = await request(app)
        .get(`/api/tickets/tags/${tag.body.tag._id}`)
        .set('Authorization', `Bearer ${otherOwner.accessToken}`);
      expect(otherWorkspaceGet.status).toBe(404);
      expect(otherWorkspaceGet.body.messageKey).toBe(
        'errors.ticketTag.notFound'
      );

      const agentIncludeInactive = await request(app)
        .get('/api/tickets/tags?includeInactive=true')
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentIncludeInactive.status).toBe(403);
      expect(agentIncludeInactive.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );

      const agentInactiveOptions = await request(app)
        .get('/api/tickets/tags/options?includeInactive=true')
        .set('Authorization', `Bearer ${agent.accessToken}`);
      expect(agentInactiveOptions.status).toBe(403);
      expect(agentInactiveOptions.body.messageKey).toBe(
        'errors.auth.forbiddenTenant'
      );

      const tagActionUnexpectedBody = await request(app)
        .post(`/api/tickets/tags/${tag.body.tag._id}/activate`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ force: true });
      expectValidationError(
        tagActionUnexpectedBody,
        'force',
        'errors.validation.unknownField'
      );

      const ownerOptionsDefault = await request(app)
        .get('/api/tickets/tags/options')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerOptionsDefault.status).toBe(200);
      expect(
        ownerOptionsDefault.body.options.some(
          (option) => option._id === tag.body.tag._id
        )
      ).toBe(false);

      const ownerListWithInactive = await request(app)
        .get('/api/tickets/tags?includeInactive=true')
        .set('Authorization', `Bearer ${owner.accessToken}`);
      expect(ownerListWithInactive.status).toBe(200);
      expect(
        ownerListWithInactive.body.tags.some(
          (item) => item._id === tag.body.tag._id
        )
      ).toBe(true);

      const unknownFieldPatch = await request(app)
        .patch(`/api/tickets/tags/${tag.body.tag._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          name: 'Renamed',
          unknownField: 'not-allowed',
        });
      expectValidationError(
        unknownFieldPatch,
        'unknownField',
        'errors.validation.unknownField'
      );

      const emptyPatch = await request(app)
        .patch(`/api/tickets/tags/${tag.body.tag._id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({});
      expectValidationError(
        emptyPatch,
        'body',
        'errors.validation.bodyRequiresAtLeastOneField'
      );
    }
  );

  maybeDbTest('tags reject duplicate normalized names', async () => {
    const owner = await createVerifiedUser({
      email: 'ticket-tags-conflicts-owner@example.com',
    });

    const first = await createTag({
      accessToken: owner.accessToken,
      name: 'VIP Customer',
    });
    expect(first.status).toBe(200);

    const duplicate = await createTag({
      accessToken: owner.accessToken,
      name: '  vip   customer  ',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.messageKey).toBe('errors.ticketTag.nameAlreadyUsed');
  });
});
