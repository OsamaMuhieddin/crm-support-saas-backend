import { createClient } from 'redis';
import { redisConfig } from '../../config/redis.config.js';

const clientRegistry = new Map();

const buildReconnectStrategy = () => ({
  reconnectStrategy(retries) {
    return Math.min(retries * 50, 1000);
  },
});

export const assertRedisConfig = () => {
  if (redisConfig.enabled && !redisConfig.url) {
    throw new Error('REDIS_URL is required when REDIS_ENABLED=true');
  }
};

export const createRedisClientInstance = ({ url = redisConfig.url } = {}) =>
  createClient({
    url: url || undefined,
    socket: buildReconnectStrategy(),
  });

export const attachRedisErrorLogger = (client, label = 'client') => {
  client.on('error', (error) => {
    console.error(`Redis ${label} error:`, error);
  });
};

export const connectRedisClient = async (client) => {
  if (!client.isOpen) {
    await client.connect();
  }

  return client;
};

export const closeRedisClient = async (client) => {
  if (!client || !client.isOpen) {
    return;
  }

  await client.quit();
};

export const getSharedRedisClient = async ({
  key = 'default',
  label = key,
  url = redisConfig.url,
} = {}) => {
  if (!redisConfig.enabled) {
    return null;
  }

  assertRedisConfig();

  if (!clientRegistry.has(key)) {
    const client = createRedisClientInstance({ url });
    attachRedisErrorLogger(client, label);
    clientRegistry.set(key, client);
  }

  return connectRedisClient(clientRegistry.get(key));
};

export const getRedisRuntimeStatus = () => ({
  enabled: redisConfig.enabled,
  connected: [...clientRegistry.values()].some((client) => client?.isReady),
});

export const closeAllRedisClients = async () => {
  const clients = [...clientRegistry.values()];

  await Promise.allSettled(clients.map((client) => closeRedisClient(client)));
  clientRegistry.clear();
};

