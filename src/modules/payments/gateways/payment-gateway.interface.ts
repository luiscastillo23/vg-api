export interface IPaymentGateway {
  name: string;
  createIntent(input: {
    orderId: string;
    amount: number;
    currency: string;
  }): Promise<{ providerId: string; clientSecret?: string }>;
  parseWebhook(
    payload: any,
    signature: string,
  ): Promise<{
    providerId: string;
    status: 'CAPTURED' | 'FAILED' | 'REFUNDED';
  }>;
}
