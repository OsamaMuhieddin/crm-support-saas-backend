import mongoose from 'mongoose';
import { jest } from '@jest/globals';

jest.setTimeout(120000);

const skipDbTests = process.env.SKIP_DB_TESTS === '1';
const mongoUri =
  process.env.TEST_MONGO_URI ||
  process.env.MONGO_URI ||
  'mongodb://127.0.0.1:27017/crm_support_saas_test';

globalThis.__DB_TESTS_DISABLED__ = skipDbTests;

beforeAll(async () => {
  if (skipDbTests) {
    return;
  }

  if (!mongoUri) {
    throw new Error('TEST_MONGO_URI or MONGO_URI is required when SKIP_DB_TESTS=0');
  }

  await mongoose.connect(mongoUri);
});

afterEach(async () => {
  if (skipDbTests) {
    return;
  }

  const collections = Object.values(mongoose.connection.collections);
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  if (skipDbTests) {
    return;
  }

  await mongoose.disconnect();
});
