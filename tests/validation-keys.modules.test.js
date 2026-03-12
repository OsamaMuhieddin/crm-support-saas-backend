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
  '../src/modules/mailboxes/validators/mailboxes.validators.js',
  '../src/modules/files/validators/files.validators.js',
];

describe('module validation i18n keys', () => {
  test('all workspace/mailbox/file validation keys exist in en/ar locales', () => {
    const usedKeys = new Set();

    for (const file of validatorFiles) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8');

      for (const key of extractValidationKeys(source)) {
        usedKeys.add(key);
      }
    }

    expect(usedKeys.size).toBeGreaterThan(0);

    const en = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/en.json', import.meta.url), 'utf8')
    );
    const ar = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/ar.json', import.meta.url), 'utf8')
    );

    for (const key of usedKeys) {
      expect(getValueByPath(en, key)).toEqual(expect.any(String));
      expect(getValueByPath(ar, key)).toEqual(expect.any(String));
    }
  });
});
