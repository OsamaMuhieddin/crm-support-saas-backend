const isMessageKey = (value) =>
  typeof value === 'string' && value.includes('.');

export const createError = (
  messageKey,
  statusCode,
  data = null,
  args = null
) => {
  const key = isMessageKey(messageKey) ? messageKey : 'errors.unknown';

  const err = new Error(key);
  err.statusCode = statusCode;
  err.messageKey = key;

  if (args) err.args = args;
  if (data) err.data = data;

  // Keep internal message only for debugging
  if (!isMessageKey(messageKey) && typeof messageKey === 'string') {
    err.internalMessage = messageKey;
  }

  return err;
};
