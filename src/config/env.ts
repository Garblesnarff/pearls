import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('8889'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  BASE_URL: z.string().default('http://localhost:8889'),

  // Database
  DATABASE_URL: z.string(),

  // WorkOS
  WORKOS_API_KEY: z.string(),
  WORKOS_CLIENT_ID: z.string(),

  // JWT
  JWT_SECRET: z.string().default('dev_secret_change_me'),

  // Role Configuration
  ADMIN_USER_IDS: z.string().default(''),
  AURORA_MEMBER_IDS: z.string().default(''),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();

export const adminUserIds = env.ADMIN_USER_IDS.split(',').filter(Boolean);
export const auroraMemberIds = env.AURORA_MEMBER_IDS.split(',').filter(Boolean);
