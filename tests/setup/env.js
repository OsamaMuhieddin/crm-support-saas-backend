const setDefaultEnv = (key, value) => {
  if (
    process.env[key] === undefined ||
    process.env[key] === null ||
    process.env[key] === ''
  ) {
    process.env[key] = value;
  }
};

setDefaultEnv('NODE_ENV', 'test');
setDefaultEnv('SKIP_DB_TESTS', '0');
setDefaultEnv(
  'TEST_MONGO_URI',
  'mongodb://127.0.0.1:27017/crm_support_saas_test'
);
setDefaultEnv('JWT_ACCESS_SECRET', 'test-access-secret');
setDefaultEnv('JWT_REFRESH_SECRET', 'test-refresh-secret');
setDefaultEnv('JWT_ACCESS_EXPIRES_IN', '15m');
setDefaultEnv('JWT_REFRESH_EXPIRES_IN', '30d');
setDefaultEnv('AUTH_BCRYPT_ROUNDS', '4');
setDefaultEnv('OTP_EXPIRES_MINUTES', '10');
setDefaultEnv('OTP_RESEND_COOLDOWN_SECONDS', '30');
setDefaultEnv('OTP_MAX_ATTEMPTS', '3');
setDefaultEnv('OTP_RATE_LIMIT_WINDOW_MINUTES', '15');
setDefaultEnv('OTP_RATE_LIMIT_MAX_PER_WINDOW', '2');
setDefaultEnv('INVITE_EXPIRES_DAYS', '7');
setDefaultEnv('EMAIL_FROM', 'test@example.com');
setDefaultEnv('APP_BASE_URL', 'http://localhost:5000');
setDefaultEnv('FRONTEND_BASE_URL', 'http://frontend.local');
setDefaultEnv('REALTIME_ENABLED', 'true');
setDefaultEnv('REALTIME_PATH', '/socket.io');
setDefaultEnv('REALTIME_TRANSPORTS', 'websocket,polling');
setDefaultEnv('REALTIME_PING_INTERVAL_MS', '25000');
setDefaultEnv('REALTIME_PING_TIMEOUT_MS', '20000');
setDefaultEnv('REALTIME_CORS_ORIGIN', 'http://frontend.local');
setDefaultEnv('REALTIME_PRESENCE_TTL_MS', '1200');
setDefaultEnv('REALTIME_TYPING_TTL_MS', '1100');
setDefaultEnv('REALTIME_SOFT_CLAIM_TTL_MS', '1200');
setDefaultEnv('REALTIME_ACTION_THROTTLE_MS', '75');
setDefaultEnv('REALTIME_DEBUG_LOGGING', 'false');
setDefaultEnv('REDIS_ENABLED', 'false');
setDefaultEnv('REDIS_URL', 'redis://127.0.0.1:6379');
setDefaultEnv('REALTIME_REDIS_ENABLED', 'false');
setDefaultEnv('REALTIME_REDIS_ADAPTER_ENABLED', 'false');
setDefaultEnv('STORAGE_PROVIDER', 'local');
setDefaultEnv('S3_BUCKET', 'crm-support-files-test');
setDefaultEnv('STORAGE_LOCAL_ROOT', '.tmp/local-storage-test');
setDefaultEnv('MAX_FILE_SIZE_BYTES', '1048576');
setDefaultEnv(
  'FILES_ALLOWED_MIME_TYPES',
  'application/pdf,image/jpeg,image/png,text/plain'
);
setDefaultEnv('FILES_ALLOWED_EXTENSIONS', '.pdf,.jpg,.jpeg,.png,.txt');
setDefaultEnv('FILES_UPLOAD_RATE_LIMIT_ENABLED', 'true');
setDefaultEnv('FILES_UPLOAD_RATE_LIMIT_WINDOW_SECONDS', '60');
setDefaultEnv('FILES_UPLOAD_RATE_LIMIT_MAX', '100');
setDefaultEnv('FILES_DOWNLOAD_RATE_LIMIT_ENABLED', 'true');
setDefaultEnv('FILES_DOWNLOAD_RATE_LIMIT_WINDOW_SECONDS', '60');
setDefaultEnv('FILES_DOWNLOAD_RATE_LIMIT_MAX', '300');
