describe('storage.config provider validation', () => {
  test('invalid storage provider config fails fast with clear error', async () => {
    const previousProvider = process.env.STORAGE_PROVIDER;
    process.env.STORAGE_PROVIDER = 'invalid-provider';

    try {
      await expect(
        import(`../src/config/storage.config.js?invalid-provider=${Date.now()}`)
      ).rejects.toThrow(
        'Invalid STORAGE_PROVIDER "invalid-provider". Expected one of: minio, s3, local'
      );
    } finally {
      if (previousProvider === undefined) {
        delete process.env.STORAGE_PROVIDER;
      } else {
        process.env.STORAGE_PROVIDER = previousProvider;
      }
    }
  });
});
