import { jest } from '@jest/globals';
import { verifyOtp } from '../src/modules/auth/services/otp.service.js';
import { OTP_PURPOSE } from '../src/constants/otp-purpose.js';
import { hashValue } from '../src/shared/utils/security.js';
import { OtpCode } from '../src/modules/users/models/otp-code.model.js';

describe('otp.service verifyOtp', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('invalid code returns 422 validation envelope with code field error', async () => {
    const otpRecord = {
      emailNormalized: 'user@example.com',
      purpose: OTP_PURPOSE.VERIFY_EMAIL,
      codeHash: hashValue('111111'),
      expiresAt: new Date(Date.now() + 60 * 1000),
      attemptCount: 0,
      consumedAt: null,
      save: jest.fn().mockResolvedValue(undefined)
    };

    jest.spyOn(OtpCode, 'findOne').mockReturnValue({
      sort: jest.fn().mockResolvedValue(otpRecord)
    });

    await expect(
      verifyOtp({
        email: 'user@example.com',
        purpose: OTP_PURPOSE.VERIFY_EMAIL,
        code: '222222'
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      messageKey: 'errors.validation.failed',
      data: [
        {
          field: 'code',
          messageKey: 'errors.otp.invalid'
        }
      ]
    });

    expect(otpRecord.attemptCount).toBe(1);
    expect(otpRecord.save).toHaveBeenCalledTimes(1);
  });

  test('scopeKey mismatch does not verify an OTP from another scope', async () => {
    jest.spyOn(OtpCode, 'findOne').mockReturnValue({
      sort: jest.fn().mockResolvedValue(null)
    });

    await expect(
      verifyOtp({
        email: 'user@example.com',
        purpose: OTP_PURPOSE.WIDGET_RECOVERY,
        code: '123456',
        scopeKey: 'widget:scope-b'
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      messageKey: 'errors.validation.failed',
      data: [
        {
          field: 'code',
          messageKey: 'errors.otp.invalid'
        }
      ]
    });

    expect(OtpCode.findOne).toHaveBeenCalledWith({
      emailNormalized: 'user@example.com',
      purpose: OTP_PURPOSE.WIDGET_RECOVERY,
      scopeKey: 'widget:scope-b',
      consumedAt: null
    });
  });
});
