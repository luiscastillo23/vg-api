import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { UserModel } from '../../../generated/prisma/models';

export type AppUser = UserModel;

export const CurrentUser = createParamDecorator(
  (data: keyof AppUser | undefined, ctx: ExecutionContext): AppUser | AppUser[keyof AppUser] | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AppUser }>();
    const user = req.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
