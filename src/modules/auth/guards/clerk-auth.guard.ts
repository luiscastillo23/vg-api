import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ClerkTokenService } from '../clerk-token.service';
import type { RequestWithAuth } from '../types/auth.types';

/**
 * Global authentication guard. Verifies the Clerk session token, attaches
 * `req.auth` (claims) and `req.user` (local mirror). Routes opt out with
 * `@Public()`.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly clerkToken: ClerkTokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const token = this.clerkToken.extractBearerToken(req.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      req.auth = await this.clerkToken.verify(token);
    } catch (err) {
      this.logger.warn(`Token verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid session token');
    }

    // Attach the local User mirror so `@CurrentUser()` and RolesGuard can read
    // it. May be undefined if the Clerk webhook has not synced this user yet.
    req.user =
      (await this.prisma.user.findUnique({
        where: { clerkId: req.auth.clerkId },
      })) ?? undefined;

    return true;
  }
}
