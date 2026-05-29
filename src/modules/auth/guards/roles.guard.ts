import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../../../generated/prisma/enums';
import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RequestWithAuth } from '../types/auth.types';

/**
 * Authorization guard for `@Roles(...)`. The role is ALWAYS read from the local
 * `User` mirror (by clerkId), never from the Clerk token — this allows admin
 * promotion via `PATCH /users/:id/role` without re-minting tokens.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const req = context.switchToHttp().getRequest<RequestWithAuth>();

    let user = req.user;
    if (!user && req.auth?.clerkId) {
      user =
        (await this.prisma.user.findUnique({
          where: { clerkId: req.auth.clerkId },
        })) ?? undefined;
      req.user = user;
    }

    if (!user) {
      throw new ForbiddenException('User profile not found');
    }
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
