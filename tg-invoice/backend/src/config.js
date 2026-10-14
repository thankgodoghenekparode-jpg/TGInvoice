import dotenv from 'dotenv';

dotenv.config();

const env = process.env.NODE_ENV || 'development';

const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT) || 5000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  jwt: {
    accessSecret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpires: process.env.JWT_ACCESS_EXPIRES || '15m',
    refreshExpiresDays: Number(process.env.JWT_REFRESH_EXPIRES_DAYS) || 7,
  },

  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
    fromName: process.env.SMTP_FROM_NAME || 'TG Invoice',
  },

  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localDir: process.env.STORAGE_LOCAL_DIR || 'uploads',
  },

  share: {
    secret: process.env.SHARE_SECRET || process.env.JWT_SECRET || 'dev-only-share-secret',
    baseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${Number(process.env.PORT) || 5000}`,
    ttlDays: Number(process.env.SHARE_LINK_DAYS) || 30,
  },

  jobs: {
    // Background worker tuning. `inline` runs a worker inside the API process
    // (fine for dev / a single free instance); production runs `npm run worker`.
    pollMs: Number(process.env.JOBS_POLL_MS) || 5000,
    batchSize: Number(process.env.JOBS_BATCH_SIZE) || 10,
    maxAttempts: Number(process.env.JOBS_MAX_ATTEMPTS) || 5,
    inline: process.env.INLINE_WORKER === 'true',
    // A RUNNING job older than this is considered abandoned and re-queued.
    staleMs: Number(process.env.JOBS_STALE_MS) || 10 * 60 * 1000,
  },

  cache: {
    driver: process.env.CACHE_DRIVER || 'memory', // memory | redis
    ttlSeconds: Number(process.env.CACHE_TTL_SECONDS) || 30,
    redisUrl: process.env.REDIS_URL || '',
  },

  rateLimit: {
    perTenant: Number(process.env.RATE_LIMIT_PER_TENANT) || 600,
    tenantWindowMs: Number(process.env.RATE_LIMIT_TENANT_WINDOW_MS) || 60 * 1000,
  },

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    businessNumber: process.env.WHATSAPP_BUSINESS_NUMBER || '',
    // Used to upgrade local numbers (0803…) to E.164 (234803…).
    countryCode: process.env.WHATSAPP_COUNTRY_CODE || '234',
  },

  sms: {
    provider: process.env.SMS_PROVIDER || '', // termii | africas_talking | twilio
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || '',
    username: process.env.SMS_USERNAME || '',
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    from: process.env.SMS_FROM || '',
  },

  payments: {
    provider: process.env.PAYMENT_PROVIDER || '', // paystack | flutterwave
    publicKey: process.env.PAYMENT_PUBLIC_KEY || '',
    secretKey: process.env.PAYMENT_SECRET_KEY || '',
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
    callbackUrl: process.env.PAYMENT_CALLBACK_URL || '',
  },

  analytics: {
    posthogKey: process.env.POSTHOG_KEY || '',
    posthogHost: process.env.POSTHOG_HOST || 'https://us.i.posthog.com',
  },

  platform: {
    // Public web app URL — used for referral links and reseller signup.
    appUrl: process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173',
  },
};

/**
 * Fail fast on missing critical secrets — but only outside test runs,
 * so tenant-isolation tests can boot without a full secret set.
 */
export function assertSecrets() {
  const missing = [];
  if (!config.jwt.accessSecret) missing.push('JWT_SECRET');
  if (!config.jwt.refreshSecret) missing.push('JWT_REFRESH_SECRET');
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Copy .env.example to .env and set them.`
    );
  }
}

export default config;
