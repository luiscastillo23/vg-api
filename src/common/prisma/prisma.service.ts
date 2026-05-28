import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '../../../generated/prisma/client';

export type PrismaTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const softDeleteModels = new Set<string>([
  // Add model names here to opt into soft delete, e.g.: 'Product'
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });

    (this as any).$on(
      'query',
      (e: { duration: number; query: string; params?: string }) => {
        if (e.duration > 250) {
          this.logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
        }
      },
    );

    (this as any).$use(async (params: any, next: (p: any) => Promise<any>) => {
      const model: string | undefined = params.model;
      if (model && softDeleteModels.has(model)) {
        if (params.action === 'delete') {
          params.action = 'update';
          params.args.data = { deletedAt: new Date() };
        } else if (params.action === 'deleteMany') {
          params.action = 'updateMany';
          params.args.data = {
            ...(params.args.data ?? {}),
            deletedAt: new Date(),
          };
        } else if (
          [
            'findUnique',
            'findFirst',
            'findMany',
            'count',
            'aggregate',
          ].includes(params.action)
        ) {
          params.args ??= {};
          params.args.where ??= {};
          params.args.where.deletedAt = null;
        }
      }
      return next(params);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async runInTransaction<T>(
    fn: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(fn as any, { timeout: 15_000, maxWait: 5_000 });
  }

  async cleanDatabase(): Promise<void> {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('cleanDatabase() must never be called in production');
    }
    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename != '_prisma_migrations'
    `;
    if (tables.length === 0) return;
    const names = tables.map((t) => `"${t.tablename}"`).join(', ');
    await this.$executeRawUnsafe(
      `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`,
    );
  }
}
