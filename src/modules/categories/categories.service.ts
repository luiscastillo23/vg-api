import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CategoriesRepository } from './categories.repository';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryQueryDto } from './dto/category-query.dto';
import { slugify } from '../../common/utils/slugify';
import type { CategoryModel } from '../../../generated/prisma/models/Category';

@Injectable()
export class CategoriesService {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(private readonly categoriesRepo: CategoriesRepository) {}

  findAll(query: CategoryQueryDto) {
    return this.categoriesRepo.findAll(
      query.page ?? 1,
      query.limit ?? 20,
      query.search,
      query.status,
      query.sortBy ?? 'createdAt',
      query.sortOrder ?? 'desc',
    );
  }

  async findOne(id: string): Promise<CategoryModel> {
    const category = await this.categoriesRepo.findById(id);
    if (!category) throw new NotFoundException(`Category ${id} not found`);
    return category;
  }

  async create(dto: CreateCategoryDto): Promise<CategoryModel> {
    return this.categoriesRepo.create({
      name: dto.name,
      slug: slugify(dto.name),
      description: dto.description,
      icon: dto.icon,
      image: dto.image,
      ...(dto.status && { status: dto.status }),
    });
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryModel> {
    await this.findOne(id);
    // slug is immutable — name changes never propagate to slug
    return this.categoriesRepo.update(id, {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
      ...(dto.image !== undefined && { image: dto.image }),
      ...(dto.status !== undefined && { status: dto.status }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.categoriesRepo.delete(id);
  }
}
