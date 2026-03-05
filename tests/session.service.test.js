import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import {
  mintAccessTokenForSession,
  rotateSessionTokens
} from '../src/modules/auth/services/session.service.js';
import { Session } from '../src/modules/users/models/session.model.js';

const createLeanQuery = (value) => {
  const query = {
    select: jest.fn(),
    lean: jest.fn()
  };

  query.select.mockReturnValue(query);
  query.lean.mockResolvedValue(value);
  return query;
};

describe('session.service', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

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

  test('mintAccessTokenForSession returns access token for active session', async () => {
    const findOneSpy = jest
      .spyOn(Session, 'findOne')
      .mockReturnValue(createLeanQuery({ _id: '507f191e810c19729de860ea' }));

    const accessToken = await mintAccessTokenForSession({
      sessionId: '507f191e810c19729de860ea',
      userId: '507f191e810c19729de860eb',
      workspaceId: '507f191e810c19729de860ec',
      roleKey: 'owner'
    });

    expect(findOneSpy).toHaveBeenCalledWith({
      _id: '507f191e810c19729de860ea',
      userId: '507f191e810c19729de860eb',
      revokedAt: null,
      expiresAt: { $gt: expect.any(Date) }
    });
    expect(accessToken).toBeTruthy();

    const payload = jwt.decode(accessToken);
    expect(payload.sub).toBe('507f191e810c19729de860eb');
    expect(payload.sid).toBe('507f191e810c19729de860ea');
    expect(payload.wid).toBe('507f191e810c19729de860ec');
    expect(payload.r).toBe('owner');
    expect(payload.typ).toBe('access');
  });

  test('mintAccessTokenForSession fails when session is missing/revoked/expired', async () => {
    jest.spyOn(Session, 'findOne').mockReturnValue(createLeanQuery(null));

    await expect(
      mintAccessTokenForSession({
        sessionId: '507f191e810c19729de860ea',
        userId: '507f191e810c19729de860eb',
        workspaceId: '507f191e810c19729de860ec',
        roleKey: 'owner'
      })
    ).rejects.toMatchObject({
      messageKey: 'errors.auth.sessionRevoked',
      statusCode: 401
    });
  });
});
