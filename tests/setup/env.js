process.env.NODE_ENV = 'test';
process.env.SKIP_DB_TESTS = process.env.SKIP_DB_TESTS || '0';
process.env.TEST_MONGO_URI =
  process.env.TEST_MONGO_URI ||
  'mongodb://127.0.0.1:27017/crm_support_saas_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.AUTH_BCRYPT_ROUNDS = '4';
process.env.OTP_EXPIRES_MINUTES = '10';
process.env.OTP_RESEND_COOLDOWN_SECONDS = '30';
process.env.OTP_MAX_ATTEMPTS = '3';
process.env.OTP_RATE_LIMIT_WINDOW_MINUTES = '15';
process.env.OTP_RATE_LIMIT_MAX_PER_WINDOW = '2';
process.env.INVITE_EXPIRES_DAYS = '7';
process.env.EMAIL_FROM = 'test@example.com';
process.env.APP_BASE_URL = 'http://localhost:5000';
process.env.FRONTEND_BASE_URL = 'http://frontend.local';
process.env.STORAGE_PROVIDER = 'local';
process.env.S3_BUCKET = 'crm-support-files-test';
process.env.STORAGE_LOCAL_ROOT = '.tmp/local-storage-test';
process.env.MAX_FILE_SIZE_BYTES = '1048576';
process.env.FILES_ALLOWED_MIME_TYPES =
  'application/pdf,image/jpeg,image/png,text/plain';
process.env.FILES_ALLOWED_EXTENSIONS = '.pdf,.jpg,.jpeg,.png,.txt';
process.env.FILES_UPLOAD_RATE_LIMIT_ENABLED = 'true';
process.env.FILES_UPLOAD_RATE_LIMIT_WINDOW_SECONDS = '60';
process.env.FILES_UPLOAD_RATE_LIMIT_MAX = '100';
process.env.FILES_DOWNLOAD_RATE_LIMIT_ENABLED = 'true';
process.env.FILES_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS = '60';
process.env.FILES_DOWNLOAD_RATE_LIMIT_MAX = '300';
