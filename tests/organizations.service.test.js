import { createOrganization, listOrganizationOptions, listOrganizations, updateOrganization } from '../src/modules/customers/services/organizations.service.js';
import { Organization } from '../src/modules/customers/models/organization.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';

const maybeDbTest = globalThis.__DB_TESTS_DISABLED__ ? test.skip : test;

let sequence = 0;

const nextValue = (prefix) => {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
};

const nextEmail = (prefix) => `${nextValue(prefix)}@example.com`;

const createWorkspaceFixture = async (prefix = 'organizations-service') => {
  const user = await User.create({
    email: nextEmail(prefix),
    isEmailVerified: true
  });

  const workspace = await Workspace.create({
    name: nextValue('Organization Workspace'),
    slug: nextValue('organization-workspace').toLowerCase(),
    ownerUserId: user._id
  });

  return {
    user,
    workspace
  };
};

describe('organizations.service', () => {
  maybeDbTest('createOrganization normalizes values before persistence', async () => {
    const { workspace } = await createWorkspaceFixture('organizations-create');

    const result = await createOrganization({
      workspaceId: workspace._id,
      payload: {
        name: '  Acme Holdings  ',
        domain: '  ACME.EXAMPLE  ',
        notes: '  Priority account  '
      }
    });

    expect(result.organization.name).toBe('Acme Holdings');
    expect(result.organization.domain).toBe('acme.example');
    expect(result.organization.notes).toBe('Priority account');

    const saved = await Organization.findById(result.organization._id).lean();
    expect(saved.nameNormalized).toBe('acme holdings');
    expect(saved.domain).toBe('acme.example');
    expect(saved.notes).toBe('Priority account');
  });

  maybeDbTest(
    'listOrganizations and listOrganizationOptions exclude deleted rows and honor workspace-scoped search/filter behavior',
    async () => {
      const { workspace: workspaceA } = await createWorkspaceFixture(
        'organizations-list-a'
      );
      const { workspace: workspaceB } = await createWorkspaceFixture(
        'organizations-list-b'
      );

      const visible = await Organization.create({
        workspaceId: workspaceA._id,
        name: 'Acme Primary',
        domain: 'acme.example'
      });
      await Organization.create({
        workspaceId: workspaceA._id,
        name: 'Acme Deleted',
        domain: 'deleted.example',
        deletedAt: new Date('2026-03-20T00:00:00.000Z')
      });
      await Organization.create({
        workspaceId: workspaceA._id,
        name: 'Beta Group',
        domain: 'beta.example'
      });
      await Organization.create({
        workspaceId: workspaceB._id,
        name: 'Workspace B Org',
        domain: 'acme.example'
      });

      const list = await listOrganizations({
        workspaceId: workspaceA._id,
        search: 'acme',
        domain: 'acme.example'
      });

      expect(list.total).toBe(1);
      expect(list.organizations).toHaveLength(1);
      expect(list.organizations[0]._id).toBe(String(visible._id));

      const options = await listOrganizationOptions({
        workspaceId: workspaceA._id,
        q: 'acme'
      });

      expect(options.options).toHaveLength(1);
      expect(options.options[0]).toEqual({
        _id: String(visible._id),
        name: 'Acme Primary',
        domain: 'acme.example'
      });
    }
  );

  maybeDbTest(
    'updateOrganization enforces same-workspace lookups and createOrganization rejects missing workspaces',
    async () => {
      const { workspace: workspaceA } = await createWorkspaceFixture(
        'organizations-update-a'
      );
      const { workspace: workspaceB } = await createWorkspaceFixture(
        'organizations-update-b'
      );

      const organization = await Organization.create({
        workspaceId: workspaceA._id,
        name: 'Update Target'
      });

      await expect(
        updateOrganization({
          workspaceId: workspaceB._id,
          organizationId: organization._id,
          payload: {
            notes: 'Should fail'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.organization.notFound'
      });

      await Workspace.updateOne(
        { _id: workspaceB._id },
        { $set: { deletedAt: new Date('2026-03-20T00:00:00.000Z') } }
      );

      await expect(
        createOrganization({
          workspaceId: workspaceB._id,
          payload: {
            name: 'Missing Workspace Org'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.workspace.notFound'
      });

      await expect(
        createOrganization({
          workspaceId: workspaceA._id,
          payload: {
            name: 'Invalid Domain Org',
            domain: 'not a domain'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        messageKey: 'errors.validation.failed',
        data: [
          expect.objectContaining({
            field: 'domain',
            messageKey: 'errors.validation.invalidDomain'
          })
        ]
      });
    }
  );
});
