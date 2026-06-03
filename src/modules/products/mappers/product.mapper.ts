import { plainToInstance } from 'class-transformer';
import { ProductResponseDto } from '../dto/product-response.dto';
import type { ProductModel } from '../../../../generated/prisma/models/Product';

/**
 * Maps Prisma `Product` rows to `ProductResponseDto`.
 *
 * Critically, `price`/`salePrice` are Prisma `Decimal` instances — emitting them
 * as JS numbers would lose precision for many monetary values. We serialize them
 * with `.toFixed(2)` so the API always returns an exact 2-decimal string.
 */
export class ProductMapper {
  static toResponse(
    product: ProductModel,
    opts?: { isFavorite?: boolean },
  ): ProductResponseDto {
    const plain = {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      sku: product.sku,
      price: product.price.toFixed(2),
      salePrice: product.salePrice ? product.salePrice.toFixed(2) : null,
      onSale: product.salePrice !== null,
      stock: product.stock,
      images: product.images,
      tags: product.tags,
      popularity: product.popularity,
      rating: product.rating,
      featured: product.featured,
      bestSeller: product.bestSeller,
      status: product.status,
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId,
      ...(opts?.isFavorite !== undefined && { isFavorite: opts.isFavorite }),
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
    return plainToInstance(ProductResponseDto, plain, {
      excludeExtraneousValues: true,
    });
  }

  static toResponseList(
    products: ProductModel[],
    favoriteIds?: Set<string>,
  ): ProductResponseDto[] {
    return products.map((p) =>
      ProductMapper.toResponse(
        p,
        favoriteIds ? { isFavorite: favoriteIds.has(p.id) } : undefined,
      ),
    );
  }
}
