import {
  createContact,
  getContactById,
  listContactOptions,
  listContacts,
  updateContact
} from '../src/modules/customers/services/contacts.service.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
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

const createWorkspaceFixture = async (prefix = 'contacts-service') => {
  const user = await User.create({
    email: nextEmail(prefix),
    isEmailVerified: true
  });

  const workspace = await Workspace.create({
    name: nextValue('Contact Workspace'),
    slug: nextValue('contact-workspace').toLowerCase(),
    ownerUserId: user._id
  });

  return {
    user,
    workspace
  };
};

describe('contacts.service', () => {
  maybeDbTest(
    'createContact and getContactById normalize persisted values and hydrate organization summaries',
    async () => {
      const { workspace } = await createWorkspaceFixture('contacts-create');
      const organization = await Organization.create({
        workspaceId: workspace._id,
        name: 'Acme Holdings',
        domain: 'acme.example'
      });

      const created = await createContact({
        workspaceId: workspace._id,
        payload: {
          fullName: '  Jane Customer  ',
          organizationId: String(organization._id),
          email: '  JANE.CUSTOMER@EXAMPLE.COM  ',
          phone: '  00963 955 555 555  ',
          tags: [' VIP ', 'vip', ' Priority '],
          customFields: {
            accountTier: '  Enterprise  ',
            prefersPhone: true
          }
        }
      });

      expect(created.contact.fullName).toBe('Jane Customer');
      expect(created.contact.email).toBe('jane.customer@example.com');
      expect(created.contact.phone).toBe('+963955555555');
      expect(created.contact.tags).toEqual(['VIP', 'Priority']);
      expect(created.contact.customFields).toEqual({
        accountTier: 'Enterprise',
        prefersPhone: true
      });
      expect(created.contact.organization).toEqual({
        _id: String(organization._id),
        name: 'Acme Holdings',
        domain: 'acme.example'
      });

      const saved = await Contact.findById(created.contact._id).lean();
      expect(saved.emailNormalized).toBe('jane.customer@example.com');
      expect(saved.phone).toBe('+963955555555');
      expect(saved.tags).toEqual(['VIP', 'Priority']);
      expect(saved.customFields).toEqual({
        accountTier: 'Enterprise',
        prefersPhone: true
      });

      const detail = await getContactById({
        workspaceId: workspace._id,
        contactId: created.contact._id
      });

      expect(detail.contact).toEqual(
        expect.objectContaining({
          _id: created.contact._id,
          organizationId: String(organization._id),
          fullName: 'Jane Customer',
          email: 'jane.customer@example.com',
          organization: {
            _id: String(organization._id),
            name: 'Acme Holdings',
            domain: 'acme.example'
          }
        })
      );
    }
  );

  maybeDbTest(
    'listContacts and listContactOptions exclude deleted rows and honor workspace-scoped search/filter behavior',
    async () => {
      const { workspace: workspaceA } = await createWorkspaceFixture(
        'contacts-list-a'
      );
      const { workspace: workspaceB } = await createWorkspaceFixture(
        'contacts-list-b'
      );
      const organization = await Organization.create({
        workspaceId: workspaceA._id,
        name: 'Acme Org',
        domain: 'acme.example'
      });

      const visible = await Contact.create({
        workspaceId: workspaceA._id,
        organizationId: organization._id,
        fullName: 'Acme Requester',
        email: 'acme.requester@example.com',
        phone: '+963955555555',
        tags: ['VIP']
      });
      await Contact.create({
        workspaceId: workspaceA._id,
        fullName: 'Acme Deleted',
        email: 'deleted@example.com',
        deletedAt: new Date('2026-03-20T00:00:00.000Z')
      });
      await Contact.create({
        workspaceId: workspaceA._id,
        fullName: 'Beta Customer',
        email: 'beta@example.com'
      });
      await Contact.create({
        workspaceId: workspaceB._id,
        fullName: 'Workspace B Contact',
        email: 'acme.requester@example.com'
      });

      const list = await listContacts({
        workspaceId: workspaceA._id,
        search: 'acme',
        organizationId: organization._id,
        email: 'ACME.REQUESTER@EXAMPLE.COM'
      });

      expect(list.total).toBe(1);
      expect(list.contacts).toHaveLength(1);
      expect(list.contacts[0]).toEqual(
        expect.objectContaining({
          _id: String(visible._id),
          organizationId: String(organization._id),
          organization: {
            _id: String(organization._id),
            name: 'Acme Org',
            domain: 'acme.example'
          }
        })
      );

      const options = await listContactOptions({
        workspaceId: workspaceA._id,
        q: 'acme'
      });

      expect(options.options).toHaveLength(1);
      expect(options.options[0]).toEqual({
        _id: String(visible._id),
        fullName: 'Acme Requester',
        email: 'acme.requester@example.com',
        phone: '+963955555555',
        organizationId: String(organization._id),
        organization: {
          _id: String(organization._id),
          name: 'Acme Org',
          domain: 'acme.example'
        }
      });
    }
  );

  maybeDbTest(
    'updateContact enforces same-workspace contact and organization lookups while createContact rejects missing workspaces',
    async () => {
      const { workspace: workspaceA } = await createWorkspaceFixture(
        'contacts-update-a'
      );
      const { workspace: workspaceB } = await createWorkspaceFixture(
        'contacts-update-b'
      );
      const organizationA = await Organization.create({
        workspaceId: workspaceA._id,
        name: 'Workspace A Org'
      });
      const organizationB = await Organization.create({
        workspaceId: workspaceB._id,
        name: 'Workspace B Org'
      });
      const contact = await Contact.create({
        workspaceId: workspaceA._id,
        organizationId: organizationA._id,
        fullName: 'Update Target',
        email: 'update.target@example.com'
      });

      await expect(
        updateContact({
          workspaceId: workspaceB._id,
          contactId: contact._id,
          payload: {
            phone: '+963955555555'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.contact.notFound'
      });

      await expect(
        updateContact({
          workspaceId: workspaceA._id,
          contactId: contact._id,
          payload: {
            organizationId: String(organizationB._id)
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
        createContact({
          workspaceId: workspaceB._id,
          payload: {
            fullName: 'Missing Workspace Contact'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.workspace.notFound'
      });

      await expect(
        createContact({
          workspaceId: workspaceA._id,
          payload: {
            fullName: 'Invalid Email Contact',
            email: 'not-an-email'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        messageKey: 'errors.validation.failed',
        data: [
          expect.objectContaining({
            field: 'email',
            messageKey: 'errors.validation.invalidEmail'
          })
        ]
      });

      await expect(
        createContact({
          workspaceId: workspaceA._id,
          payload: {
            fullName: 'Invalid Phone Contact',
            phone: 'not-a-phone'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        messageKey: 'errors.validation.failed',
        data: [
          expect.objectContaining({
            field: 'phone',
            messageKey: 'errors.validation.invalidPhone'
          })
        ]
      });

      const updated = await updateContact({
        workspaceId: workspaceA._id,
        contactId: contact._id,
        payload: {
          organizationId: null,
          email: '  Updated.Target@Example.com ',
          tags: null,
          customFields: null
        }
      });

      expect(updated.contact.organizationId).toBeNull();
      expect(updated.contact.organization).toBeNull();
      expect(updated.contact.email).toBe('updated.target@example.com');
      expect(updated.contact.tags).toEqual([]);
      expect(updated.contact.customFields).toBeNull();
    }
  );
});
