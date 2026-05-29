import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import type { ClerkConfig } from '../../config/env.types';

interface ClerkWebhookEvent {
  type: string;
  data: Record<string, any>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Verify a Clerk (Svix-signed) webhook against the raw body, then mirror the
   * user into the local DB. Idempotent: the Svix message id is persisted in
   * `WebhookEvent`, so duplicate deliveries are a no-op.
   */
  async handleClerkWebhook(
    payload: Buffer | string,
    headers: Record<string, string>,
  ): Promise<{ received: boolean }> {
    const secret = this.config.get<ClerkConfig>('clerk')?.webhookSigningSecret;
    if (!secret) {
      this.logger.error('CLERK_WEBHOOK_SIGNING_SECRET is not configured');
      throw new BadRequestException('Webhook not configured');
    }

    // 1. Verify the signature on the RAW body before reading any field.
    //    Svix also rejects stale timestamps, mitigating replay.
    const svixId = headers['svix-id'];
    let event: ClerkWebhookEvent;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(payload, {
        'svix-id': svixId,
        'svix-timestamp': headers['svix-timestamp'],
        'svix-signature': headers['svix-signature'],
      }) as ClerkWebhookEvent;
    } catch (err) {
      this.logger.warn(
        `Clerk webhook signature verification failed: ${(err as Error).message}`,
      );
      throw new BadRequestException('Invalid webhook signature');
    }

    const eventId = svixId ?? `${event.type}:${event.data?.id}`;

    // 2. Record the event id + mirror the user in one transaction. A unique
    //    violation on (provider, eventId) means it was already processed.
    try {
      await this.prisma.runInTransaction(async (tx) => {
        await tx.webhookEvent.create({
          data: {
            provider: 'clerk',
            eventId,
            eventType: event.type,
            payload: event as any,
          },
        });
        await this.applyClerkEvent(tx, event);
      });
    } catch (err) {
      if (
        err instanceof PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.debug(`Duplicate Clerk webhook ${eventId} ignored`);
        return { received: true };
      }
      throw err;
    }

    return { received: true };
  }

  private async applyClerkEvent(
    tx: PrismaTransactionClient,
    event: ClerkWebhookEvent,
  ): Promise<void> {
    const data = event.data ?? {};
    const clerkId: string | undefined = data.id;
    if (!clerkId) return;

    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        const email = this.primaryEmail(data);
        await tx.user.upsert({
          where: { clerkId },
          // `role` is intentionally never written here — it is owned locally.
          create: {
            clerkId,
            email: email ?? `${clerkId}@clerk.local`,
            passwordHash: '', // legacy column; auth is delegated to Clerk
            firstName: data.first_name ?? '',
            lastName: data.last_name ?? '',
            avatar: data.image_url ?? null,
            status: 'ACTIVE',
            emailVerifiedAt: email ? new Date() : null,
          },
          update: {
            ...(email ? { email } : {}),
            firstName: data.first_name ?? '',
            lastName: data.last_name ?? '',
            avatar: data.image_url ?? null,
          },
        });
        break;
      }
      case 'user.deleted': {
        await tx.user.updateMany({
          where: { clerkId },
          data: { status: 'INACTIVE' },
        });
        break;
      }
      default:
        this.logger.debug(`Unhandled Clerk webhook type: ${event.type}`);
    }
  }

  private primaryEmail(data: Record<string, any>): string | undefined {
    const list: Array<{ id: string; email_address: string }> =
      data.email_addresses ?? [];
    const primary =
      list.find((e) => e.id === data.primary_email_address_id) ?? list[0];
    return primary?.email_address;
  }
}
