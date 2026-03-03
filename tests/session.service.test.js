import { jest } from '@jest/globals';
import { rotateSessionTokens } from '../src/modules/auth/services/session.service.js';

describe('session.service', () => {
  test('rotateSessionTokens does not clear revokedAt', async () => {
    const revokedAt = new Date('2026-01-01T00:00:00.000Z');
    const session = {
      _id: '507f191e810c19729de860ea',
      revokedAt,
      save: jest.fn().mockResolvedValue(undefined)
    };

    await rotateSessionTokens({
      session,
      userId: '507f191e810c19729de860eb',
      workspaceId: '507f191e810c19729de860ec',
      roleKey: 'owner'
    });

    expect(session.save).toHaveBeenCalledTimes(1);
    expect(session.revokedAt).toBe(revokedAt);
    expect(session.workspaceId).toBe('507f191e810c19729de860ec');
    expect(session.refreshTokenHash).toBeTruthy();
  });
});
