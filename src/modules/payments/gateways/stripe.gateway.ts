import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { IPaymentGateway } from './payment-gateway.interface';

@Injectable()
export class StripeGateway implements IPaymentGateway {
  readonly name = 'stripe';
  private readonly stripe: InstanceType<typeof Stripe>;
  constructor(private readonly config: ConfigService) {
    this.stripe = new Stripe(config.getOrThrow('STRIPE_SECRET'), {
      apiVersion: '2024-06-20' as any,
    });
  }
  async createIntent({
    orderId,
    amount,
    currency,
  }: {
    orderId: string;
    amount: number;
    currency: string;
  }) {
    const intent = await this.stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      metadata: { orderId },
      automatic_payment_methods: { enabled: true },
    });
    return {
      providerId: intent.id,
      clientSecret: intent.client_secret ?? undefined,
    };
  }
  async parseWebhook(rawBody: Buffer, signature: string) {
    const event = this.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      this.config.getOrThrow('STRIPE_WEBHOOK_SECRET'),
    );
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as { id: string };
      return { providerId: pi.id, status: 'CAPTURED' as const };
    }
    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as { id: string };
      return { providerId: pi.id, status: 'FAILED' as const };
    }
    return { providerId: '', status: 'FAILED' as const };
  }
}
