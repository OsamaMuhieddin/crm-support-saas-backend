import mongoose from 'mongoose';
import { jest } from '@jest/globals';
import { redisConfig } from '../../src/config/redis.config.js';
import { shutdownRealtime } from '../../src/infra/realtime/index.js';
import {
  closeRedisClient,
  connectRedisClient,
  createRedisClientInstance,
} from '../../src/infra/redis/index.js';

jest.setTimeout(120000);

const skipDbTests = process.env.SKIP_DB_TESTS === '1';
const mongoUri =
  process.env.TEST_MONGO_URI ||
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/crm_support_saas_test';

const assertSafeTestMongoUri = () => {
  if (skipDbTests) {
    return;
  }

  const normalized = String(mongoUri || '').trim().toLowerCase();
  const isExplicitTestDb =
    normalized.includes('crm_support_saas_test') ||
    normalized.includes('_test') ||
    normalized.includes('-test');

  if (!isExplicitTestDb) {
    throw new Error(
      `Refusing destructive test cleanup against non-test Mongo URI: ${mongoUri}`
    );
  }
};

globalThis.__DB_TESTS_DISABLED__ = skipDbTests;

beforeAll(async () => {
  if (skipDbTests) {
    return;
  }

  if (!mongoUri) {
    throw new Error('TEST_MONGO_URI or MONGO_URI is required when SKIP_DB_TESTS=0');
  }

  assertSafeTestMongoUri();
  await mongoose.connect(mongoUri);
});

afterEach(async () => {
  if (skipDbTests) {
    return;
  }

  assertSafeTestMongoUri();
  await shutdownRealtime();

  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));

  if (redisConfig.enabled) {
    const redisClient = createRedisClientInstance();

    try {
      await connectRedisClient(redisClient);
      await redisClient.flushDb();
    } finally {
      await closeRedisClient(redisClient);
    }
  }
});

afterAll(async () => {
  if (skipDbTests) {
    return;
  }

  assertSafeTestMongoUri();
  await shutdownRealtime();
  await mongoose.disconnect();
});
