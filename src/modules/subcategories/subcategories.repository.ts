import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import type { SubcategoryModel } from '../../../generated/prisma/models/Subcategory';
import type { EntityStatus } from '../../../generated/prisma/enums';

type SubcategoryCreate = {
  name: string;
  slug: string;
  description?: string;
  categoryId: string;
  status?: EntityStatus;
};

type SubcategoryPatch = Partial<{
  name: string;
  description: string;
  status: EntityStatus;
  categoryId: string;
}>;

@Injectable()
export class SubcategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(
    page: number,
    limit: number,
    search?: string,
    categoryId?: string,
    status?: EntityStatus,
    sortBy = 'createdAt',
    sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    const where = {
      ...(categoryId && { categoryId }),
      ...(status && { status }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };
    return paginate(
      this.prisma.subcategory,
      { where, orderBy: [{ [sortBy]: sortOrder }, { id: 'asc' }] },
      page,
      limit,
    );
  }

  findById(id: string): Promise<SubcategoryModel | null> {
    return this.prisma.subcategory.findUnique({ where: { id } });
  }

  create(data: SubcategoryCreate, tx?: PrismaTransactionClient): Promise<SubcategoryModel> {
    return (tx ?? this.prisma).subcategory.create({ data });
  }

  update(id: string, data: SubcategoryPatch, tx?: PrismaTransactionClient): Promise<SubcategoryModel> {
    return (tx ?? this.prisma).subcategory.update({ where: { id }, data });
  }

  delete(id: string): Promise<SubcategoryModel> {
    return this.prisma.subcategory.delete({ where: { id } });
  }
}
