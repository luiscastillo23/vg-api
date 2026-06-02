import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { plainToInstance } from 'class-transformer';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CategoryQueryDto } from './dto/category-query.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../../generated/prisma/enums';

const toDto = (category: unknown) =>
  plainToInstance(CategoryResponseDto, category, { excludeExtraneousValues: true });

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Paginated list of categories' })
  @ApiResponse({ status: 200, description: 'Paginated categories list' })
  async findAll(@Query() query: CategoryQueryDto) {
    const result = await this.categoriesService.findAll(query);
    return { ...result, items: result.items.map(toDto) };
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a single category by ID' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: CategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return toDto(await this.categoriesService.findOne(id));
  }

  @Post()
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a category — slug auto-derived from name and immutable' })
  @ApiResponse({ status: 201, type: CategoryResponseDto })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  async create(@Body() dto: CreateCategoryDto) {
    return toDto(await this.categoriesService.create(dto));
  }

  @Patch(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update a category — slug is immutable after creation' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: CategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Category not found' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return toDto(await this.categoriesService.update(id, dto));
  }

  @Delete(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a category — fails with 409 if subcategories exist' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 204, description: 'Category deleted' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  @ApiResponse({ status: 409, description: 'Category has linked subcategories or products' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.categoriesService.remove(id);
  }
}
