import {
  createContactIdentity,
  listContactIdentities
} from '../src/modules/customers/services/contact-identities.service.js';
import { ContactIdentity } from '../src/modules/customers/models/contact-identity.model.js';
import { Contact } from '../src/modules/customers/models/contact.model.js';
import { User } from '../src/modules/users/models/user.model.js';
import { Workspace } from '../src/modules/workspaces/models/workspace.model.js';

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

const createWorkspaceFixture = async (prefix = 'contact-identities-service') => {
  const user = await User.create({
    email: nextEmail(prefix),
    isEmailVerified: true
  });

  const workspace = await Workspace.create({
    name: nextValue('Contact Identity Workspace'),
    slug: nextValue('contact-identity-workspace').toLowerCase(),
    ownerUserId: user._id
  });

  return {
    user,
    workspace
  };
};

const createContactFixture = async ({
  workspaceId,
  fullName = 'Identity Contact',
  email = null
}) =>
  Contact.create({
    workspaceId,
    fullName,
    email
  });

describe('contact-identities.service', () => {
  maybeDbTest(
    'createContactIdentity persists normalized matching values while listContactIdentities returns lean API views',
    async () => {
      const { workspace } = await createWorkspaceFixture(
        'contact-identities-create'
      );
      const contact = await createContactFixture({
        workspaceId: workspace._id,
        fullName: 'Identity Target'
      });

      const emailIdentity = await createContactIdentity({
        workspaceId: workspace._id,
        contactId: contact._id,
        payload: {
          type: 'email',
          value: '  Mixed.Case@Example.com  '
        }
      });

      const phoneIdentity = await createContactIdentity({
        workspaceId: workspace._id,
        contactId: contact._id,
        payload: {
          type: 'phone',
          value: '  +963 (955)-000-111  '
        }
      });

      expect(emailIdentity.identity).toEqual(
        expect.objectContaining({
          workspaceId: String(workspace._id),
          contactId: String(contact._id),
          type: 'email',
          value: 'mixed.case@example.com',
          verifiedAt: null
        })
      );
      expect(phoneIdentity.identity.value).toBe('+963955000111');
      expectExactKeys(emailIdentity.identity, CONTACT_IDENTITY_KEYS);
      expect(emailIdentity.identity.valueNormalized).toBeUndefined();

      const savedEmailIdentity = await ContactIdentity.findById(
        emailIdentity.identity._id
      ).lean();
      const savedPhoneIdentity = await ContactIdentity.findById(
        phoneIdentity.identity._id
      ).lean();

      expect(savedEmailIdentity.valueNormalized).toBe('mixed.case@example.com');
      expect(savedEmailIdentity.value).toBe('mixed.case@example.com');
      expect(savedPhoneIdentity.valueNormalized).toBe('+963955000111');

      const listed = await listContactIdentities({
        workspaceId: workspace._id,
        contactId: contact._id
      });

      expect(listed.identities).toHaveLength(2);
      expect(listed.identities[0]._id).toBe(emailIdentity.identity._id);
      expect(listed.identities[1]._id).toBe(phoneIdentity.identity._id);
      for (const identity of listed.identities) {
        expectExactKeys(identity, CONTACT_IDENTITY_KEYS);
        expect(identity.valueNormalized).toBeUndefined();
      }
    }
  );

  maybeDbTest(
    'listContactIdentities stays scoped to the parent contact and createContactIdentity maps duplicate conflicts cleanly',
    async () => {
      const { workspace: workspaceA } = await createWorkspaceFixture(
        'contact-identities-scope-a'
      );
      const { workspace: workspaceB } = await createWorkspaceFixture(
        'contact-identities-scope-b'
      );
      const contactA = await createContactFixture({
        workspaceId: workspaceA._id,
        fullName: 'Workspace A Contact'
      });
      const contactB = await createContactFixture({
        workspaceId: workspaceA._id,
        fullName: 'Workspace A Contact B'
      });
      const foreignContact = await createContactFixture({
        workspaceId: workspaceB._id,
        fullName: 'Workspace B Contact'
      });

      await createContactIdentity({
        workspaceId: workspaceA._id,
        contactId: contactA._id,
        payload: {
          type: 'email',
          value: 'owner@example.com'
        }
      });
      await createContactIdentity({
        workspaceId: workspaceA._id,
        contactId: contactB._id,
        payload: {
          type: 'phone',
          value: '+963955123456'
        }
      });

      const list = await listContactIdentities({
        workspaceId: workspaceA._id,
        contactId: contactA._id
      });

      expect(list.identities).toHaveLength(1);
      expect(list.identities[0].contactId).toBe(String(contactA._id));

      await expect(
        listContactIdentities({
          workspaceId: workspaceB._id,
          contactId: contactA._id
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.contact.notFound'
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceB._id,
          contactId: contactA._id,
          payload: {
            type: 'phone',
            value: '+963955999999'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.contact.notFound'
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceA._id,
          contactId: foreignContact._id,
          payload: {
            type: 'whatsapp',
            value: '+963955888888'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 404,
        messageKey: 'errors.contact.notFound'
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceA._id,
          contactId: contactB._id,
          payload: {
            type: 'email',
            value: 'OWNER@example.com'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        messageKey: 'errors.contactIdentity.alreadyExists'
      });

      await createContactIdentity({
        workspaceId: workspaceA._id,
        contactId: contactA._id,
        payload: {
          type: 'phone',
          value: '+963 (955)-888-777'
        }
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceA._id,
          contactId: contactB._id,
          payload: {
            type: 'phone',
            value: '+963955888777'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        messageKey: 'errors.contactIdentity.alreadyExists'
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceA._id,
          contactId: contactA._id,
          payload: {
            type: 'email',
            value: 'not-an-email'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        messageKey: 'errors.validation.failed',
        data: [
          expect.objectContaining({
            field: 'value',
            messageKey: 'errors.validation.invalidEmail'
          })
        ]
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceA._id,
          contactId: contactA._id,
          payload: {
            type: 'phone',
            value: 'not-a-phone'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        messageKey: 'errors.validation.failed',
        data: [
          expect.objectContaining({
            field: 'value',
            messageKey: 'errors.validation.invalidPhone'
          })
        ]
      });

      await expect(
        createContactIdentity({
          workspaceId: workspaceA._id,
          contactId: contactA._id,
          payload: {
            type: 'telegram',
            value: 'handle'
          }
        })
      ).rejects.toMatchObject({
        statusCode: 422,
        messageKey: 'errors.validation.failed',
        data: [
          expect.objectContaining({
            field: 'type',
            messageKey: 'errors.validation.invalidEnum'
          })
        ]
      });
    }
  );
});
