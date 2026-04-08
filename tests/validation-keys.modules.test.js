import { readFileSync } from 'node:fs';

const getValueByPath = (obj, path) =>
  path.split('.').reduce((acc, part) => {
    if (acc && Object.prototype.hasOwnProperty.call(acc, part)) {
      return acc[part];
    }

    return undefined;
  }, obj);

const extractValidationKeys = (content) =>
  [...content.matchAll(/errors\.validation\.[a-zA-Z0-9]+/g)].map(
    (match) => match[0]
  );

const validatorFiles = [
  '../src/modules/workspaces/validators/workspaces.validators.js',
  '../src/modules/auth/validators/auth.validators.js',
  '../src/modules/admin/validators/admin-auth.validators.js',
  '../src/modules/customers/validators/contacts.validators.js',
  '../src/modules/customers/validators/contact-identities.validators.js',
  '../src/modules/customers/validators/organizations.validators.js',
  '../src/modules/mailboxes/validators/mailboxes.validators.js',
  '../src/modules/sla/validators/sla.validators.js',
  '../src/modules/files/validators/files.validators.js',
  '../src/modules/reports/validators/reports.validators.js',
  '../src/modules/tickets/validators/ticket-categories.validators.js',
  '../src/modules/tickets/validators/ticket-tags.validators.js',
  '../src/modules/tickets/validators/tickets.validators.js',
  '../src/modules/tickets/validators/ticket-messages.validators.js',
  '../src/modules/tickets/validators/ticket-participants.validators.js',
];

describe('module validation i18n keys', () => {
  test('all workspace/customer/mailbox/file/ticket validation keys exist in en/ar locales', () => {
    const usedKeys = new Set();

    for (const file of validatorFiles) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');

      for (const key of extractValidationKeys(source)) {
        usedKeys.add(key);
      }
    }

    expect(usedKeys.size).toBeGreaterThan(0);

    const en = JSON.parse(
      readFileSync(
        new URL('../src/i18n/locales/en.json', import.meta.url),
        'utf8'
      )
    );
    const ar = JSON.parse(
      readFileSync(
        new URL('../src/i18n/locales/ar.json', import.meta.url),
        'utf8'
      )
    );

    for (const key of usedKeys) {
      expect(getValueByPath(en, key)).toEqual(expect.any(String));
      expect(getValueByPath(ar, key)).toEqual(expect.any(String));
    }
  });
});
