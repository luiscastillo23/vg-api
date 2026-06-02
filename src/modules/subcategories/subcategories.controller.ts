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
import { SubcategoriesService } from './subcategories.service';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';
import { SubcategoryQueryDto } from './dto/subcategory-query.dto';
import { SubcategoryResponseDto } from './dto/subcategory-response.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../../generated/prisma/enums';

const toDto = (subcategory: unknown) =>
  plainToInstance(SubcategoryResponseDto, subcategory, { excludeExtraneousValues: true });

@ApiTags('subcategories')
@Controller('subcategories')
export class SubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Paginated list of subcategories, filterable by categoryId' })
  @ApiResponse({ status: 200, description: 'Paginated subcategories list' })
  async findAll(@Query() query: SubcategoryQueryDto) {
    const result = await this.subcategoriesService.findAll(query);
    return { ...result, items: result.items.map(toDto) };
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Get a single subcategory by ID' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: SubcategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Subcategory not found' })
  async findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return toDto(await this.subcategoriesService.findOne(id));
  }

  @Post()
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a subcategory — slug auto-derived from name and immutable' })
  @ApiResponse({ status: 201, type: SubcategoryResponseDto })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  async create(@Body() dto: CreateSubcategoryDto) {
    return toDto(await this.subcategoriesService.create(dto));
  }

  @Patch(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update a subcategory — slug is immutable after creation' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: SubcategoryResponseDto })
  @ApiResponse({ status: 404, description: 'Subcategory not found' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateSubcategoryDto,
  ) {
    return toDto(await this.subcategoriesService.update(id, dto));
  }

  @Delete(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a subcategory — fails with 409 if products or services reference it' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 204, description: 'Subcategory deleted' })
  @ApiResponse({ status: 404, description: 'Subcategory not found' })
  @ApiResponse({ status: 409, description: 'Subcategory has linked products or services' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.subcategoriesService.remove(id);
  }
}
