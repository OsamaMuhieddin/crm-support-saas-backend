import { createError } from '../errors/createError.js';

const createBucket = () => ({
  startedAt: Date.now(),
  count: 0,
});

export const createRateLimiter = ({
  windowMs,
  max,
  messageKey = 'errors.validation.failed',
  statusCode = 429,
  enabled = true,
  keyGenerator = null,
}) => {
  const buckets = new Map();
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60 * 1000);
  const safeMax = Math.max(1, Number(max) || 60);

  return (req, res, next) => {
    try {
      if (!enabled) {
        return next();
      }

      const ipKey = req.ip || req.socket?.remoteAddress || 'unknown';
      const actorKey = req?.auth?.userId || ipKey;
      const customKey =
        typeof keyGenerator === 'function' ? keyGenerator(req) : null;
      const key = customKey || actorKey;

      const now = Date.now();
      const existingBucket = buckets.get(key);
      const bucket =
        existingBucket && now - existingBucket.startedAt < safeWindowMs
          ? existingBucket
          : createBucket();

      bucket.count += 1;
      buckets.set(key, bucket);

      if (bucket.count > safeMax) {
        throw createError(messageKey, statusCode);
      }

      if (buckets.size > 10000) {
        for (const [bucketKey, value] of buckets.entries()) {
          if (now - value.startedAt >= safeWindowMs) {
            buckets.delete(bucketKey);
          }
        }
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

export default createRateLimiter;
