import IORedis from 'ioredis';
import { Queue, Worker } from 'bullmq';
import { redisConfig } from '../../config/redis.config.js';

const resourceRegistry = new Set();
const connectionRegistry = new Map();

const buildRedisConnection = (key) => {
  if (!redisConfig.enabled || !redisConfig.url) {
    return null;
  }

  if (!connectionRegistry.has(key)) {
    const connection = new IORedis(redisConfig.url, {
      maxRetriesPerRequest: null,
    });

    connection.on('error', (error) => {
      console.error(`BullMQ Redis ${key} error:`, error);
    });

    connectionRegistry.set(key, connection);
  }

  return connectionRegistry.get(key);
};

export const isBullMqEnabled = () =>
  Boolean(redisConfig.enabled && redisConfig.url);

export const createBullMqQueue = ({ name, defaultJobOptions } = {}) => {
  if (!isBullMqEnabled()) {
    return null;
  }

  const queue = new Queue(name, {
    connection: buildRedisConnection(`queue:${name}`),
    defaultJobOptions,
  });

  resourceRegistry.add(queue);
  return queue;
};

export const createBullMqWorker = ({
  name,
  processor,
  concurrency = 5,
} = {}) => {
  if (!isBullMqEnabled()) {
    return null;
  }

  const worker = new Worker(name, processor, {
    connection: buildRedisConnection(`worker:${name}:${Date.now()}`),
    concurrency,
  });

  worker.on('error', (error) => {
    console.error(`BullMQ worker ${name} error:`, error);
  });

  resourceRegistry.add(worker);
  return worker;
};

export const closeBullMqResources = async () => {
  const resources = [...resourceRegistry];
  resourceRegistry.clear();

  await Promise.allSettled(
    resources.map(async (resource) => {
      if (resource?.close) {
        await resource.close();
      }
    })
  );

  const connections = [...connectionRegistry.values()];
  connectionRegistry.clear();

  await Promise.allSettled(connections.map((connection) => connection.quit()));
};
