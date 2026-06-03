import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import type {
  ServiceModel,
  ServiceOrderByWithRelationInput,
  ServiceWhereInput,
} from '../../../generated/prisma/models/Service';
import type { EntityStatus } from '../../../generated/prisma/enums';
import { ServiceSort } from './dto/service-query.dto';

export interface ServiceFilters {
  search?: string;
  status?: EntityStatus;
  categoryId?: string;
  subcategoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  bestSeller?: boolean;
  onSale?: boolean;
}

type ServiceCreate = {
  name: string;
  slug: string;
  description: string;
  price: number;
  salePrice?: number | null;
  capacity: number;
  images: string[];
  bestSeller?: boolean;
  status?: EntityStatus;
  categoryId: string;
  subcategoryId?: string | null;
};

// slug is immutable after creation.
type ServicePatch = Partial<Omit<ServiceCreate, 'slug'>>;

const RELATED_ORDER: ServiceOrderByWithRelationInput[] = [
  { popularity: 'desc' },
  { id: 'asc' },
];

@Injectable()
export class ServicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Composable WHERE builder — every provided filter is AND-combined. */
  buildWhere(filters: ServiceFilters): ServiceWhereInput {
    const where: ServiceWhereInput = {};

    if (filters.status) where.status = filters.status;
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.subcategoryId) where.subcategoryId = filters.subcategoryId;
    if (filters.bestSeller !== undefined) where.bestSeller = filters.bestSeller;
    if (filters.onSale) where.salePrice = { not: null };

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {
        ...(filters.minPrice !== undefined && { gte: filters.minPrice }),
        ...(filters.maxPrice !== undefined && { lte: filters.maxPrice }),
      };
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' as const } },
        { description: { contains: filters.search, mode: 'insensitive' as const } },
      ];
    }

    return where;
  }

  private buildOrderBy(sort?: ServiceSort): ServiceOrderByWithRelationInput[] {
    switch (sort) {
      case ServiceSort.PRICE_ASC:
        return [{ price: 'asc' }, { id: 'asc' }];
      case ServiceSort.PRICE_DESC:
        return [{ price: 'desc' }, { id: 'asc' }];
      case ServiceSort.NEWEST:
        return [{ createdAt: 'desc' }, { id: 'asc' }];
      case ServiceSort.POPULARITY:
      default:
        return [{ popularity: 'desc' }, { id: 'asc' }];
    }
  }

  findAll(
    filters: ServiceFilters,
    sort: ServiceSort | undefined,
    page: number,
    limit: number,
  ) {
    return paginate(
      this.prisma.service,
      { where: this.buildWhere(filters), orderBy: this.buildOrderBy(sort) },
      page,
      limit,
    );
  }

  findById(id: string): Promise<ServiceModel | null> {
    return this.prisma.service.findUnique({ where: { id } });
  }

  findBySlug(slug: string): Promise<ServiceModel | null> {
    return this.prisma.service.findUnique({ where: { slug } });
  }

  findRelated(
    categoryId: string,
    excludeId: string,
    limit: number,
  ): Promise<ServiceModel[]> {
    return this.prisma.service.findMany({
      where: { categoryId, status: 'ACTIVE', id: { not: excludeId } },
      orderBy: RELATED_ORDER,
      take: limit,
    });
  }

  async favoritedServiceIds(
    userId: string,
    serviceIds: string[],
  ): Promise<Set<string>> {
    if (serviceIds.length === 0) return new Set();
    const rows = await this.prisma.favorite.findMany({
      where: { userId, serviceId: { in: serviceIds } },
      select: { serviceId: true },
    });
    return new Set(
      rows
        .map((r) => r.serviceId)
        .filter((id): id is string => id !== null),
    );
  }

  create(data: ServiceCreate, tx?: PrismaTransactionClient): Promise<ServiceModel> {
    return (tx ?? this.prisma).service.create({ data });
  }

  update(
    id: string,
    data: ServicePatch,
    tx?: PrismaTransactionClient,
  ): Promise<ServiceModel> {
    return (tx ?? this.prisma).service.update({ where: { id }, data });
  }

  delete(id: string): Promise<ServiceModel> {
    return this.prisma.service.delete({ where: { id } });
  }

  /** Non-throwing popularity bump (updateMany no-ops on a missing row). */
  async incrementPopularity(id: string): Promise<void> {
    await this.prisma.service.updateMany({
      where: { id },
      data: { popularity: { increment: 1 } },
    });
  }
}
