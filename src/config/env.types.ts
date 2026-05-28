export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type StorageProvider = 's3' | 'cloudinary';
export type MailProvider = 'brevo' | 'preview';
export type PaypalEnv = 'sandbox' | 'live';
export type BitpayEnv = 'test' | 'prod';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  appUrl: string;
  webUrlOrigin: string;
  logLevel: LogLevel;
}

export interface DatabaseConfig {
  url: string;
  logQueries: boolean;
}

export interface RedisConfig {
  url: string | undefined;
}

export interface ClerkConfig {
  publishableKey: string;
  secretKey: string;
  jwtKey: string | undefined;
  webhookSigningSecret: string;
  authorizedParties: string[];
}

export interface BrevoConfig {
  apiKey: string | undefined;
  senderName: string | undefined;
  senderEmail: string | undefined;
  webhookToken: string | undefined;
  mailProvider: MailProvider;
}

export interface S3Config {
  region: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucket: string | undefined;
  publicUrl: string | undefined;
  endpoint: string | undefined;
  forcePathStyle: boolean;
}

export interface StorageConfig {
  provider: StorageProvider;
  s3: S3Config;
  cloudinaryUrl: string | undefined;
}

export interface StripeConfig {
  secretKey: string | undefined;
  webhookSecret: string | undefined;
}

export interface PaypalConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
  env: PaypalEnv;
  webhookId: string | undefined;
}

export interface BinancePayConfig {
  apiKey: string | undefined;
  apiSecret: string | undefined;
}

export interface LemonSqueezyConfig {
  apiKey: string | undefined;
  storeId: string | undefined;
  webhookSecret: string | undefined;
}

export interface NowPaymentsConfig {
  apiKey: string | undefined;
  ipnSecret: string | undefined;
}

export interface BitpayConfig {
  token: string | undefined;
  env: BitpayEnv;
  notificationToken: string | undefined;
}

export interface PaymentConfig {
  stripe: StripeConfig;
  paypal: PaypalConfig;
  binancePay: BinancePayConfig;
  lemonSqueezy: LemonSqueezyConfig;
  nowPayments: NowPaymentsConfig;
  bitpay: BitpayConfig;
}

export interface ThrottlerConfig {
  ttl: number;
  limit: number;
}

export interface ObservabilityConfig {
  sentryDsn: string | undefined;
  gitSha: string | undefined;
}

export interface FullConfig {
  app: AppConfig;
  database: DatabaseConfig;
  redis: RedisConfig;
  clerk: ClerkConfig;
  brevo: BrevoConfig;
  storage: StorageConfig;
  payments: PaymentConfig;
  throttler: ThrottlerConfig;
  observability: ObservabilityConfig;
}
