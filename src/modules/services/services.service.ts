import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ServicesRepository } from './services.repository';
import type { ServiceFilters } from './services.repository';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceQueryDto } from './dto/service-query.dto';
import { slugify } from '../../common/utils/slugify';
import type { ServiceModel } from '../../../generated/prisma/models/Service';

const RELATED_LIMIT = 8;

@Injectable()
export class ServicesService {
  private readonly logger = new Logger(ServicesService.name);

  constructor(private readonly servicesRepo: ServicesRepository) {}

  private toFilters(query: ServiceQueryDto): ServiceFilters {
    return {
      search: query.search,
      status: query.status,
      categoryId: query.categoryId,
      subcategoryId: query.subcategoryId,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      bestSeller: query.bestSeller,
      onSale: query.onSale,
    };
  }

  findAll(query: ServiceQueryDto) {
    return this.servicesRepo.findAll(
      this.toFilters(query),
      query.sort,
      query.page ?? 1,
      query.limit ?? 20,
    );
  }

  favoritedServiceIds(userId: string, serviceIds: string[]) {
    return this.servicesRepo.favoritedServiceIds(userId, serviceIds);
  }

  async findById(id: string): Promise<ServiceModel> {
    const service = await this.servicesRepo.findById(id);
    if (!service) throw new NotFoundException(`Service ${id} not found`);
    return service;
  }

  async findBySlug(slug: string): Promise<ServiceModel> {
    const service = await this.servicesRepo.findBySlug(slug);
    if (!service) throw new NotFoundException(`Service "${slug}" not found`);
    void this.servicesRepo
      .incrementPopularity(service.id)
      .catch((err: unknown) =>
        this.logger.warn(
          `popularity bump failed for ${service.id}: ${String(err)}`,
        ),
      );
    return service;
  }

  async findRelated(id: string): Promise<ServiceModel[]> {
    const service = await this.findById(id);
    return this.servicesRepo.findRelated(
      service.categoryId,
      service.id,
      RELATED_LIMIT,
    );
  }

  create(dto: CreateServiceDto): Promise<ServiceModel> {
    return this.servicesRepo.create({
      name: dto.name,
      slug: slugify(dto.name),
      description: dto.description,
      price: dto.price,
      salePrice: dto.salePrice ?? null,
      capacity: dto.capacity,
      images: dto.images,
      ...(dto.bestSeller !== undefined && { bestSeller: dto.bestSeller }),
      ...(dto.status && { status: dto.status }),
      categoryId: dto.categoryId,
      subcategoryId: dto.subcategoryId ?? null,
    });
  }

  async update(id: string, dto: UpdateServiceDto): Promise<ServiceModel> {
    await this.findById(id);
    // slug is immutable after creation.
    return this.servicesRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.price !== undefined && { price: dto.price }),
      ...(dto.salePrice !== undefined && { salePrice: dto.salePrice }),
      ...(dto.capacity !== undefined && { capacity: dto.capacity }),
      ...(dto.images !== undefined && { images: dto.images }),
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
    await this.servicesRepo.delete(id);
  }

  /** Pricing snapshot seam for the orders module: resolves the effective unit price. */
  async getPurchaseSnapshot(
    id: string,
  ): Promise<{ serviceId: string; name: string; unitPrice: ServiceModel['price'] }> {
    const service = await this.findById(id);
    return {
      serviceId: service.id,
      name: service.name,
      unitPrice: service.salePrice ?? service.price,
    };
  }
}
