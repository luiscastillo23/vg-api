import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ProductsRepository } from './products.repository';
import type { ProductFilters } from './products.repository';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { slugify } from '../../common/utils/slugify';
import type { ProductModel } from '../../../generated/prisma/models/Product';

const RELATED_LIMIT = 8;

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly productsRepo: ProductsRepository) {}

  private toFilters(query: ProductQueryDto): ProductFilters {
    return {
      search: query.search,
      status: query.status,
      categoryId: query.categoryId,
      subcategoryId: query.subcategoryId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      featured: query.featured,
      bestSeller: query.bestSeller,
      onSale: query.onSale,
      tag: query.tag,
    };
  }

  findAll(query: ProductQueryDto) {
    return this.productsRepo.findAll(
      this.toFilters(query),
      query.sort,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  favoritedProductIds(userId: string, productIds: string[]) {
    return this.productsRepo.favoritedProductIds(userId, productIds);
  }

  async findById(id: string): Promise<ProductModel> {
    const product = await this.productsRepo.findById(id);
    if (!product) throw new NotFoundException(`Product ${id} not found`);
    return product;
  }

  async findBySlug(slug: string): Promise<ProductModel> {
    const product = await this.productsRepo.findBySlug(slug);
    if (!product) throw new NotFoundException(`Product "${slug}" not found`);
    // Popularity counter — non-blocking; a failed bump must never fail the read.
    void this.productsRepo
      .incrementPopularity(product.id)
      .catch((err: unknown) =>
        this.logger.warn(
          `popularity bump failed for ${product.id}: ${String(err)}`,
        ),
      );
    return product;
  }

  async findRelated(id: string): Promise<ProductModel[]> {
    const product = await this.findById(id);
    return this.productsRepo.findRelated(
      product.categoryId,
      product.id,
      RELATED_LIMIT,
    );
  }

  create(dto: CreateProductDto): Promise<ProductModel> {
    // slug derived from name once; uniqueness is enforced by the DB unique
    // constraint (P2002 -> 409 via PrismaExceptionFilter) and never changes.
    return this.productsRepo.create({
      name: dto.name,
      slug: slugify(dto.name),
      description: dto.description,
      sku: dto.sku,
      price: dto.price,
      salePrice: dto.salePrice ?? null,
      stock: dto.stock,
      images: dto.images,
      tags: dto.tags ?? [],
      ...(dto.featured !== undefined && { featured: dto.featured }),
      ...(dto.bestSeller !== undefined && { bestSeller: dto.bestSeller }),
      ...(dto.status && { status: dto.status }),
      categoryId: dto.categoryId,
      subcategoryId: dto.subcategoryId ?? null,
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<ProductModel> {
    await this.findById(id);
    // slug & sku immutable; stock changes only via adjustStock().
    return this.productsRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.price !== undefined && { price: dto.price }),
      ...(dto.salePrice !== undefined && { salePrice: dto.salePrice }),
      ...(dto.images !== undefined && { images: dto.images }),
      ...(dto.tags !== undefined && { tags: dto.tags }),
      ...(dto.featured !== undefined && { featured: dto.featured }),
      ...(dto.bestSeller !== undefined && { bestSeller: dto.bestSeller }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
      ...(dto.subcategoryId !== undefined && {
        subcategoryId: dto.subcategoryId,
      }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.productsRepo.delete(id);
  }

  async setFeatured(id: string, featured: boolean): Promise<ProductModel> {
    await this.findById(id);
    return this.productsRepo.setFeatured(id, featured);
  }

  /**
   * Atomic stock adjustment — the ONLY supported way to change stock. Decrements
   * use a conditional WHERE so concurrent requests cannot underflow; a 0-row
   * result means either the product is gone (404) or the change would drive
   * stock negative (409).
   */
  async adjustStock(id: string, dto: AdjustStockDto): Promise<ProductModel> {
    const affected = await this.productsRepo.adjustStock(id, dto.delta);
    if (affected === 0) {
      const exists = await this.productsRepo.findById(id);
      if (!exists) throw new NotFoundException(`Product ${id} not found`);
      throw new ConflictException('Insufficient stock for this adjustment');
    }
    return this.findById(id);
  }

  /**
   * Pricing snapshot seam for the future orders module: resolves the effective
   * unit price (sale price when set, else base price) plus a name snapshot for
   * an OrderItem. Stays in Prisma `Decimal` — never converts to float.
   */
  async getPurchaseSnapshot(
    id: string,
  ): Promise<{ productId: string; name: string; unitPrice: ProductModel['price'] }> {
    const product = await this.findById(id);
    return {
      productId: product.id,
      name: product.name,
      unitPrice: product.salePrice ?? product.price,
    };
  }
}
