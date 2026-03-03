export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setup/env.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.js']
};
