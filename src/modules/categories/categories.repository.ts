import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import type { CategoryModel } from '../../../generated/prisma/models/Category';
import type { EntityStatus } from '../../../generated/prisma/enums';

type CategoryCreate = {
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  image?: string;
  status?: EntityStatus;
};

type CategoryPatch = Partial<Omit<CategoryCreate, 'slug'>>;

@Injectable()
export class CategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(
    page: number,
    limit: number,
    search?: string,
    status?: EntityStatus,
    sortBy = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    const where = {
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };
    return paginate(
      this.prisma.category,
      { where, orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }] },
      page,
      limit,
    );
  }

  findById(id: string): Promise<CategoryModel | null> {
    return this.prisma.category.findUnique({ where: { id } });
  }

  create(data: CategoryCreate, tx?: PrismaTransactionClient): Promise<CategoryModel> {
    return (tx ?? this.prisma).category.create({ data });
  }

  update(id: string, data: CategoryPatch, tx?: PrismaTransactionClient): Promise<CategoryModel> {
    return (tx ?? this.prisma).category.update({ where: { id }, data });
  }

  delete(id: string): Promise<CategoryModel> {
    return this.prisma.category.delete({ where: { id } });
  }
}
