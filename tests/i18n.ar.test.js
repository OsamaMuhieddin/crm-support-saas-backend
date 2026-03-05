import { readFileSync } from 'node:fs';

describe('Arabic locale translations', () => {
  test('workspace switch and membership errors are localized in Arabic', () => {
    const ar = JSON.parse(
      readFileSync(new URL('../src/i18n/locales/ar.json', import.meta.url), 'utf8')
    );

    expect(ar.success.workspace.switched).toBe('تم تبديل مساحة العمل بنجاح.');
    expect(ar.errors.workspace.notMember).toBe(
      'أنت لست عضوًا في مساحة العمل هذه.'
    );
    expect(ar.errors.workspace.inactiveMember).toBe(
      'حالة عضويتك في مساحة العمل غير نشطة.'
    );
  });
});
