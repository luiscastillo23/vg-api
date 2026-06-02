import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SubcategoriesRepository } from './subcategories.repository';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';
import { SubcategoryQueryDto } from './dto/subcategory-query.dto';
import { slugify } from '../../common/utils/slugify';
import type { SubcategoryModel } from '../../../generated/prisma/models/Subcategory';

@Injectable()
export class SubcategoriesService {
  private readonly logger = new Logger(SubcategoriesService.name);

  constructor(private readonly subcategoriesRepo: SubcategoriesRepository) {}

  findAll(query: SubcategoryQueryDto) {
    return this.subcategoriesRepo.findAll(
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
      query.categoryId,
      query.status,
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );
  }

  async findOne(id: string): Promise<SubcategoryModel> {
    const subcategory = await this.subcategoriesRepo.findById(id);
    if (!subcategory) throw new NotFoundException(`Subcategory ${id} not found`);
    return subcategory;
  }

  async create(dto: CreateSubcategoryDto): Promise<SubcategoryModel> {
    return this.subcategoriesRepo.create({
      name: dto.name,
      slug: slugify(dto.name),
      description: dto.description,
      categoryId: dto.categoryId,
      ...(dto.status && { status: dto.status }),
    });
  }

  async update(id: string, dto: UpdateSubcategoryDto): Promise<SubcategoryModel> {
    await this.findOne(id);
    // slug is immutable — name changes never propagate to slug
    return this.subcategoriesRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.categoryId !== undefined && { categoryId: dto.categoryId }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.subcategoriesRepo.delete(id);
  }
}
