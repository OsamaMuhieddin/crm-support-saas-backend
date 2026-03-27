import { createAdapter } from '@socket.io/redis-adapter';
import { realtimeConfig } from '../../config/realtime.config.js';
import { redisConfig } from '../../config/redis.config.js';
import {
  assertRedisConfig,
  attachRedisErrorLogger,
  closeAllRedisClients,
  connectRedisClient,
  createRedisClientInstance,
  getRedisRuntimeStatus,
  getSharedRedisClient,
} from '../redis/index.js';

let adapterClients = null;

export const getRealtimeRedisClient = async () => {
  if (!redisConfig.enabled) {
    return null;
  }

  return getSharedRedisClient({
    key: 'realtime-coordination',
    label: 'realtime coordination client',
  });
};

export const configureRealtimeRedisAdapter = async (io) => {
  if (!redisConfig.enabled || !realtimeConfig.redis.adapterEnabled || !io) {
    return null;
  }

  assertRedisConfig();

  if (!adapterClients) {
    const pubClient = createRedisClientInstance();
    const subClient = pubClient.duplicate();

    attachRedisErrorLogger(pubClient, 'realtime adapter pub client');
    attachRedisErrorLogger(subClient, 'realtime adapter sub client');

    await Promise.all([
      connectRedisClient(pubClient),
      connectRedisClient(subClient),
    ]);
    adapterClients = { pubClient, subClient };
  }

  io.adapter(createAdapter(adapterClients.pubClient, adapterClients.subClient));

  return adapterClients;
};

export const getRealtimeRedisStatus = () => ({
  ...getRedisRuntimeStatus(),
  adapterEnabled: realtimeConfig.redis.adapterEnabled,
  adapterConnected: Boolean(
    adapterClients?.pubClient?.isReady && adapterClients?.subClient?.isReady
  ),
});

export const closeRealtimeRedis = async () => {
  await closeAllRedisClients();
  adapterClients = null;
};
