import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ClerkTokenService } from '../clerk-token.service';
import type { RequestWithAuth } from '../types/auth.types';

/**
 * Attaches `req.auth` / `req.user` when a valid token is present, but NEVER
 * throws — used on routes that are public yet personalized for signed-in users.
 * Apply per-route with `@UseGuards(OptionalAuthGuard)` on a `@Public()` route.
 */
@Injectable()
export class OptionalAuthGuard implements CanActivate {
  private readonly logger = new Logger(OptionalAuthGuard.name);

  constructor(
    private readonly clerkToken: ClerkTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.clerkToken.extractBearerToken(req.headers?.authorization);
    if (!token) return true; // anonymous — proceed

    try {
      req.auth = await this.clerkToken.verify(token);
      req.user =
        (await this.prisma.user.findUnique({
          where: { clerkId: req.auth.clerkId },
        })) ?? undefined;
    } catch (err) {
      this.logger.debug(
        `Optional auth ignored invalid token: ${(err as Error).message}`,
      );
    }
    return true;
  }
}
