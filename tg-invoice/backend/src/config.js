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
