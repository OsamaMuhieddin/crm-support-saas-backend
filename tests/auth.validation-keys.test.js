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

describe('auth validation i18n keys', () => {
  test('all auth validation keys exist in en/ar locales', () => {
    const authValidatorSource = readFileSync(
      new URL('../src/modules/auth/validators/auth.validators.js', import.meta.url),
      'utf8'
    );
    const otpServiceSource = readFileSync(
      new URL('../src/modules/auth/services/otp.service.js', import.meta.url),
      'utf8'
    );

    const usedKeys = new Set([
      ...extractValidationKeys(authValidatorSource),
      ...extractValidationKeys(otpServiceSource),
    ]);

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
