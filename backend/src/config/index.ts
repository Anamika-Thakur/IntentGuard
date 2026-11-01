import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('*'),
  DATABASE_URL: z.string().optional(),
  USE_IN_MEMORY_DB: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  AUTH_HMAC_SECRET_KEY_V1: z
    .string()
    .min(32, 'HMAC secret must be at least 32 characters')
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),
  AUTH_ACTIVE_KEY_ID: z.string().default('v1'),
  PAYPAL_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  PAYPAL_API_BASE_URL: z.string().url().default('https://api-m.sandbox.paypal.com'),
  PAYPAL_CLIENT_ID: z.string().default('placeholder_client_id'),
  PAYPAL_CLIENT_SECRET: z.string().default('placeholder_client_secret'),
  AI_AGENT_MAX_PROPOSAL_CENTS: z.coerce.number().int().positive().default(50000),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadConfig(overrideEnv?: Record<string, string>): EnvConfig {
  const source = overrideEnv ?? process.env;
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Environment configuration validation failed:\n${errorDetails}`);
  }

  // Security assertion: Never allow PAYPAL_ENV=production in this engine
  if (parsed.data.PAYPAL_ENV === 'production') {
    throw new Error('Production PayPal environment is explicitly disallowed in IntentGuard Sandbox engine.');
  }

  return parsed.data;
}

export const config = loadConfig();
