import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { PrismaTransactionClient } from '../../common/prisma/prisma.service';
import { paginate } from '../../common/utils/paginate';
import type {
  ProductModel,
  ProductOrderByWithRelationInput,
  ProductWhereInput,
} from '../../../generated/prisma/models/Product';
import type { EntityStatus } from '../../../generated/prisma/enums';
import { ProductSort } from './dto/product-query.dto';

export interface ProductFilters {
  search?: string;
  status?: EntityStatus;
  categoryId?: string;
  subcategoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  featured?: boolean;
  bestSeller?: boolean;
  onSale?: boolean;
  tag?: string;
}

type ProductCreate = {
  name: string;
  slug: string;
  description: string;
  sku: string;
  price: number;
  salePrice?: number | null;
  stock: number;
  images: string[];
  tags?: string[];
  featured?: boolean;
  bestSeller?: boolean;
  status?: EntityStatus;
  categoryId: string;
  subcategoryId?: string | null;
};

// slug, sku and stock are not patchable here: slug/sku are immutable and stock
// flows only through adjustStock().
type ProductPatch = Partial<Omit<ProductCreate, 'slug' | 'sku' | 'stock'>>;

const RELATED_ORDER: ProductOrderByWithRelationInput[] = [
  { popularity: 'desc' },
  { id: 'asc' },
];

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Composable WHERE builder — every provided filter is AND-combined. */
  buildWhere(filters: ProductFilters): ProductWhereInput {
    const where: ProductWhereInput = {};

    if (filters.status) where.status = filters.status;
    if (filters.categoryId) where.categoryId = filters.categoryId;
    if (filters.subcategoryId) where.subcategoryId = filters.subcategoryId;
    if (filters.featured !== undefined) where.featured = filters.featured;
    if (filters.bestSeller !== undefined) where.bestSeller = filters.bestSeller;
    if (filters.onSale) where.salePrice = { not: null };
    if (filters.tag) where.tags = { has: filters.tag };

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
        { sku: { contains: filters.search, mode: 'insensitive' as const } },
      ];
    }

    return where;
  }

  /** Maps a sort key to a deterministic orderBy (secondary id keeps pages stable). */
  private buildOrderBy(sort?: ProductSort): ProductOrderByWithRelationInput[] {
    switch (sort) {
      case ProductSort.PRICE_ASC:
        return [{ price: 'asc' }, { id: 'asc' }];
      case ProductSort.PRICE_DESC:
        return [{ price: 'desc' }, { id: 'asc' }];
      case ProductSort.NEWEST:
        return [{ createdAt: 'desc' }, { id: 'asc' }];
      case ProductSort.RATING:
        return [{ rating: 'desc' }, { id: 'asc' }];
      case ProductSort.POPULARITY:
      default:
        return [{ popularity: 'desc' }, { id: 'asc' }];
    }
  }

  findAll(
    filters: ProductFilters,
    sort: ProductSort | undefined,
    page: number,
    limit: number,
  ) {
    return paginate(
      this.prisma.product,
      { where: this.buildWhere(filters), orderBy: this.buildOrderBy(sort) },
      page,
      limit,
    );
  }

  findById(id: string): Promise<ProductModel | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findBySlug(slug: string): Promise<ProductModel | null> {
    return this.prisma.product.findUnique({ where: { slug } });
  }

  findRelated(
    categoryId: string,
    excludeId: string,
    limit: number,
  ): Promise<ProductModel[]> {
    return this.prisma.product.findMany({
      where: { categoryId, status: 'ACTIVE', id: { not: excludeId } },
      orderBy: RELATED_ORDER,
      take: limit,
    });
  }

  /** productIds (from the given list) that the user has favorited. */
  async favoritedProductIds(
    userId: string,
    productIds: string[],
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const rows = await this.prisma.favorite.findMany({
      where: { userId, productId: { in: productIds } },
      select: { productId: true },
    });
    return new Set(
      rows
        .map((r) => r.productId)
        .filter((id): id is string => id !== null),
    );
  }

  create(data: ProductCreate, tx?: PrismaTransactionClient): Promise<ProductModel> {
    return (tx ?? this.prisma).product.create({ data });
  }

  update(
    id: string,
    data: ProductPatch,
    tx?: PrismaTransactionClient,
  ): Promise<ProductModel> {
    return (tx ?? this.prisma).product.update({ where: { id }, data });
  }

  delete(id: string): Promise<ProductModel> {
    return this.prisma.product.delete({ where: { id } });
  }

  setFeatured(id: string, featured: boolean): Promise<ProductModel> {
    return this.prisma.product.update({ where: { id }, data: { featured } });
  }

  /**
   * Atomic stock change. For decrements the WHERE guard (`stock >= -delta`) makes
   * the operation race-safe: if the change would drive stock negative the row
   * does not match and `count` is 0 — no read-modify-write window. Returns the
   * number of affected rows (0 or 1).
   */
  async adjustStock(
    id: string,
    delta: number,
    tx?: PrismaTransactionClient,
  ): Promise<number> {
    const where =
      delta < 0 ? { id, stock: { gte: -delta } } : { id };
    const res = await (tx ?? this.prisma).product.updateMany({
      where,
      data: { stock: { increment: delta } },
    });
    return res.count;
  }

  /** Non-throwing popularity bump (updateMany no-ops on a missing row). */
  async incrementPopularity(id: string): Promise<void> {
    await this.prisma.product.updateMany({
      where: { id },
      data: { popularity: { increment: 1 } },
    });
  }
}
