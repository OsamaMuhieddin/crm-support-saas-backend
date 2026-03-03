import crypto from 'crypto';

export const hashValue = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex');

export const generateOtpCode = (length = 6) => {
  const digits = '0123456789';
  let code = '';

  for (let i = 0; i < length; i += 1) {
    const randomIndex = crypto.randomInt(0, digits.length);
    code += digits[randomIndex];
  }

  return code;
};

export const generateSecureToken = (size = 32) =>
  crypto.randomBytes(size).toString('hex');

