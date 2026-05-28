import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // ── App ─────────────────────────────────────────────────────────────────
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  WEB_URL_ORIGIN: Joi.string().uri().required(),
  LOG_LEVEL: Joi.string()
    .valid('trace', 'debug', 'info', 'warn', 'error', 'fatal')
    .default('info'),

  // ── Database ─────────────────────────────────────────────────────────────
  DATABASE_URL: Joi.string().required(),
  PRISMA_LOG_QUERIES: Joi.boolean().default(false),

  // ── Redis ─────────────────────────────────────────────────────────────────
  REDIS_URL: Joi.string().optional(),

  // ── Clerk ────────────────────────────────────────────────────────────────
  CLERK_PUBLISHABLE_KEY: Joi.string().required(),
  CLERK_SECRET_KEY: Joi.string().required(),
  CLERK_JWT_KEY: Joi.string().optional().allow(''),
  CLERK_WEBHOOK_SIGNING_SECRET: Joi.string().required(),
  CLERK_AUTHORIZED_PARTIES: Joi.string().required(),

  // ── Brevo (required only in production) ──────────────────────────────────
  BREVO_API_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  BREVO_SENDER_NAME: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  BREVO_SENDER_EMAIL: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  BREVO_WEBHOOK_TOKEN: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional().allow(''),
  }),
  MAIL_PROVIDER: Joi.string().valid('brevo', 'preview').default('brevo'),

  // ── Storage ───────────────────────────────────────────────────────────────
  STORAGE_PROVIDER: Joi.string().valid('s3', 'cloudinary').required(),
  AWS_REGION: Joi.string().optional().allow(''),
  AWS_ACCESS_KEY_ID: Joi.string().optional().allow(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().optional().allow(''),
  AWS_S3_BUCKET: Joi.string().optional().allow(''),
  AWS_S3_PUBLIC_URL: Joi.string().uri().optional().allow(''),
  // Must be empty in production — MinIO/LocalStack only
  AWS_S3_ENDPOINT: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.valid('').optional(),
    otherwise: Joi.string().optional().allow(''),
  }),
  AWS_S3_FORCE_PATH_STYLE: Joi.boolean().default(false),
  CLOUDINARY_URL: Joi.string().optional().allow(''),

  // ── Payments — Stripe ─────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: Joi.string().optional().allow(''),
  STRIPE_WEBHOOK_SECRET: Joi.string().optional().allow(''),

  // ── Payments — PayPal ─────────────────────────────────────────────────────
  PAYPAL_CLIENT_ID: Joi.string().optional().allow(''),
  PAYPAL_CLIENT_SECRET: Joi.string().optional().allow(''),
  PAYPAL_ENV: Joi.string().valid('sandbox', 'live').default('sandbox'),
  PAYPAL_WEBHOOK_ID: Joi.string().optional().allow(''),

  // ── Payments — Binance Pay ────────────────────────────────────────────────
  BINANCE_PAY_API_KEY: Joi.string().optional().allow(''),
  BINANCE_PAY_API_SECRET: Joi.string().optional().allow(''),

  // ── Payments — Lemon Squeezy ──────────────────────────────────────────────
  LEMONSQUEEZY_API_KEY: Joi.string().optional().allow(''),
  LEMONSQUEEZY_STORE_ID: Joi.string().optional().allow(''),
  LEMONSQUEEZY_WEBHOOK_SECRET: Joi.string().optional().allow(''),

  // ── Payments — NOWPayments ────────────────────────────────────────────────
  NOWPAYMENTS_API_KEY: Joi.string().optional().allow(''),
  NOWPAYMENTS_IPN_SECRET: Joi.string().optional().allow(''),

  // ── Payments — BitPay ─────────────────────────────────────────────────────
  BITPAY_TOKEN: Joi.string().optional().allow(''),
  BITPAY_ENV: Joi.string().valid('test', 'prod').default('test'),
  BITPAY_NOTIFICATION_TOKEN: Joi.string().optional().allow(''),

  // ── Throttler ─────────────────────────────────────────────────────────────
  THROTTLE_TTL: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(120),

  // ── Observability ─────────────────────────────────────────────────────────
  SENTRY_DSN: Joi.string().optional().allow(''),
  GIT_SHA: Joi.string().optional().allow(''),
});
