import { plainToInstance } from 'class-transformer';
import { ServiceResponseDto } from '../dto/service-response.dto';
import type { ServiceModel } from '../../../../generated/prisma/models/Service';

export class ServiceMapper {
  static toResponse(
    service: ServiceModel,
    opts?: { isFavorite?: boolean },
  ): ServiceResponseDto {
    const plain = {
      id: service.id,
      name: service.name,
      slug: service.slug,
      description: service.description,
      price: service.price.toFixed(2),
      salePrice: service.salePrice ? service.salePrice.toFixed(2) : null,
      onSale: service.salePrice !== null,
      capacity: service.capacity,
      images: service.images,
      popularity: service.popularity,
      bestSeller: service.bestSeller,
      status: service.status,
      categoryId: service.categoryId,
      subcategoryId: service.subcategoryId,
      ...(opts?.isFavorite !== undefined && { isFavorite: opts.isFavorite }),
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
    };
    return plainToInstance(ServiceResponseDto, plain, {
      excludeExtraneousValues: true,
    });
  }

  static toResponseList(
    services: ServiceModel[],
    favoriteIds?: Set<string>,
  ): ServiceResponseDto[] {
    return services.map((s) =>
      ServiceMapper.toResponse(
        s,
        favoriteIds ? { isFavorite: favoriteIds.has(s.id) } : undefined,
      ),
    );
  }
}
