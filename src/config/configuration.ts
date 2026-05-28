import type {
  BitpayEnv,
  FullConfig,
  LogLevel,
  MailProvider,
  NodeEnv,
  PaypalEnv,
  StorageProvider,
} from './env.types';

export default (): FullConfig => ({
  app: {
    nodeEnv: (process.env.NODE_ENV ?? 'development') as NodeEnv,
    port: Number(process.env.PORT) || 3000,
    appUrl: process.env.APP_URL ?? 'http://localhost:3000',
    webUrlOrigin: process.env.WEB_URL_ORIGIN!,
    logLevel: (process.env.LOG_LEVEL ?? 'info') as LogLevel,
  },

  database: {
    url: process.env.DATABASE_URL!,
    logQueries: process.env.PRISMA_LOG_QUERIES === 'true',
  },

  redis: {
    url: process.env.REDIS_URL || undefined,
  },

  clerk: {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
    secretKey: process.env.CLERK_SECRET_KEY!,
    jwtKey: process.env.CLERK_JWT_KEY || undefined,
    webhookSigningSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET!,
    authorizedParties: (process.env.CLERK_AUTHORIZED_PARTIES ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean),
  },

  brevo: {
    apiKey: process.env.BREVO_API_KEY || undefined,
    senderName: process.env.BREVO_SENDER_NAME || undefined,
    senderEmail: process.env.BREVO_SENDER_EMAIL || undefined,
    webhookToken: process.env.BREVO_WEBHOOK_TOKEN || undefined,
    mailProvider: (process.env.MAIL_PROVIDER ?? 'brevo') as MailProvider,
  },

  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? 's3') as StorageProvider,
    s3: {
      region: process.env.AWS_REGION || undefined,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || undefined,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || undefined,
      bucket: process.env.AWS_S3_BUCKET || undefined,
      publicUrl: process.env.AWS_S3_PUBLIC_URL || undefined,
      endpoint: process.env.AWS_S3_ENDPOINT || undefined,
      forcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === 'true',
    },
    cloudinaryUrl: process.env.CLOUDINARY_URL || undefined,
  },

  payments: {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || undefined,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || undefined,
    },
    paypal: {
      clientId: process.env.PAYPAL_CLIENT_ID || undefined,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET || undefined,
      env: (process.env.PAYPAL_ENV ?? 'sandbox') as PaypalEnv,
      webhookId: process.env.PAYPAL_WEBHOOK_ID || undefined,
    },
    binancePay: {
      apiKey: process.env.BINANCE_PAY_API_KEY || undefined,
      apiSecret: process.env.BINANCE_PAY_API_SECRET || undefined,
    },
    lemonSqueezy: {
      apiKey: process.env.LEMONSQUEEZY_API_KEY || undefined,
      storeId: process.env.LEMONSQUEEZY_STORE_ID || undefined,
      webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET || undefined,
    },
    nowPayments: {
      apiKey: process.env.NOWPAYMENTS_API_KEY || undefined,
      ipnSecret: process.env.NOWPAYMENTS_IPN_SECRET || undefined,
    },
    bitpay: {
      token: process.env.BITPAY_TOKEN || undefined,
      env: (process.env.BITPAY_ENV ?? 'test') as BitpayEnv,
      notificationToken: process.env.BITPAY_NOTIFICATION_TOKEN || undefined,
    },
  },

  throttler: {
    ttl: Number(process.env.THROTTLE_TTL) || 60_000,
    limit: Number(process.env.THROTTLE_LIMIT) || 120,
  },

  observability: {
    sentryDsn: process.env.SENTRY_DSN || undefined,
    gitSha: process.env.GIT_SHA || undefined,
  },
});
