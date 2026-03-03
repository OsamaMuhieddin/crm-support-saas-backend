import { jest } from '@jest/globals';
import { resendOtp } from '../src/modules/auth/services/auth.service.js';
import { OTP_PURPOSE } from '../src/constants/otp-purpose.js';
import { User } from '../src/modules/users/models/user.model.js';

describe('auth.service resendOtp', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('resetPassword does not create/send OTP for non-existing user', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue(null);

    const logs = [];
    const logSpy = jest.spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args);
    });

    const result = await resendOtp({
      email: 'missing@example.com',
      purpose: OTP_PURPOSE.RESET_PASSWORD
    });

    logSpy.mockRestore();

    expect(result).toEqual({});
    expect(logs).toHaveLength(0);
  });

  test('resetPassword does not create/send OTP for unverified user', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue({
      _id: 'user-1',
      email: 'user@example.com',
      isEmailVerified: false,
      status: 'active',
      deletedAt: null
    });
    const logs = [];
    const logSpy = jest.spyOn(console, 'info').mockImplementation((...args) => {
      logs.push(args);
    });

    const result = await resendOtp({
      email: 'user@example.com',
      purpose: OTP_PURPOSE.RESET_PASSWORD
    });

    logSpy.mockRestore();

    expect(result).toEqual({});
    expect(logs).toHaveLength(0);
  });
});
