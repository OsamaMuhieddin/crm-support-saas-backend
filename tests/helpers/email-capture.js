import { jest } from '@jest/globals';

export const captureFallbackEmail = async (action) => {
  const logs = [];
  const spy = jest.spyOn(console, 'info').mockImplementation((...args) => {
    logs.push(args);
  });

  try {
    const response = await action();
    return { response, logs };
  } finally {
    spy.mockRestore();
  }
};

export const extractOtpCodeFromLogs = (logs) => {
  for (const entry of logs) {
    const payload = entry?.[1];
    if (payload?.code) {
      return String(payload.code);
    }
  }

  return null;
};

export const extractInviteTokenFromLogs = (logs) => {
  for (const entry of logs) {
    const payload = entry?.[1];
    if (!payload?.inviteLinkOrToken) {
      continue;
    }

    try {
      const link = new URL(payload.inviteLinkOrToken);
      const token = link.searchParams.get('token');
      if (token) {
        return token;
      }
    } catch (error) {
      // ignore invalid URL entries
    }
  }

  return null;
};
