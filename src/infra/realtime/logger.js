import { realtimeConfig } from '../../config/realtime.config.js';

const formatMeta = (meta) => {
  if (!meta || typeof meta !== 'object') {
    return '';
  }

  const safeEntries = Object.entries(meta).filter(
    ([, value]) => value !== undefined
  );

  if (safeEntries.length === 0) {
    return '';
  }

  return ` ${JSON.stringify(Object.fromEntries(safeEntries))}`;
};

export const logRealtimeDebug = (message, meta = null) => {
  if (!realtimeConfig.debugLogging) {
    return;
  }

  console.debug(`[realtime] ${message}${formatMeta(meta)}`);
};

export const logRealtimeWarn = (message, meta = null) => {
  console.warn(`[realtime] ${message}${formatMeta(meta)}`);
};
