import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import type { UserModel } from '../../../generated/prisma/models/User';
import type { Role, UserStatus } from '../../../generated/prisma/enums';

type UserPatch = Partial<{
  firstName: string;
  lastName: string;
  phone: string | null;
  avatar: string | null;
  email: string;
  role: Role;
  status: UserStatus;
}>;

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(
    page: number,
    limit: number,
    search?: string,
    role?: Role,
    status?: UserStatus,
    sortBy = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    // AND filters first (use compound index on role+status), then OR text search.
    // mode: 'insensitive' is the Prisma 6 PostgreSQL approach — maps to ILIKE/citext.
    // Secondary id sort ensures stable pages when primary key has ties.
    const where = {
      ...(role && { role }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' as const } },
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };
    return paginate(
      this.prisma.user,
      { where, orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }] },
      page,
      limit,
    );
  }

  findById(id: string): Promise<UserModel | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  update(id: string, data: UserPatch, tx?: PrismaTransactionClient): Promise<UserModel> {
    return (tx ?? this.prisma).user.update({ where: { id }, data });
  }

  delete(id: string): Promise<UserModel> {
    return this.prisma.user.delete({ where: { id } });
  }

  async getStats(id: string) {
    const [orderCount, reviewCount, balance] = await Promise.all([
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.review.count({ where: { userId: id } }),
      this.prisma.balance.findUnique({ where: { userId: id } }),
    ]);
    return {
      orderCount,
      reviewCount,
      balance: balance
        ? { amount: balance.amount.toString(), currency: balance.currency }
        : null,
    };
  }

  getActivity(id: string, page: number, limit: number) {
    return paginate(
      this.prisma.activityLog,
      { where: { userId: id }, orderBy: { createdAt: 'desc' } },
      page,
      limit,
    );
  }
}
