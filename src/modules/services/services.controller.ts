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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { ServiceQueryDto } from './dto/service-query.dto';
import { ServiceResponseDto } from './dto/service-response.dto';
import { ServiceMapper } from './mappers/service.mapper';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AppUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { Role } from '../../../generated/prisma/enums';

const PUBLIC_CACHE = 'public, max-age=60';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Public service catalog — paginated, filterable, sortable',
    description: [
      'All filters are optional and **AND-combined** — every filter you pass must match.',
      '',
      '- `search`: case-insensitive match across name and description.',
      '- `status`: lifecycle filter (omit to list every status; pass `ACTIVE` for the live catalog).',
      '- `minPrice` / `maxPrice`: inclusive bounds on the **base** price (not the sale price).',
      '- `bestSeller` / `onSale`: boolean flags; `onSale=true` means a sale price is set.',
      '- `categoryId` / `subcategoryId`: scope to a catalog branch.',
      '- `sort`: popularity | priceAsc | priceDesc | newest (default: popularity).',
      '',
      'Authenticated callers additionally receive `isFavorite` on each service.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ServiceResponseDto, isArray: true })
  async findAll(
    @Query() query: ServiceQueryDto,
    @CurrentUser() user: AppUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', PUBLIC_CACHE);
    const result = await this.servicesService.findAll(query);
    const favoriteIds = user
      ? await this.servicesService.favoritedServiceIds(
          user.id,
          result.items.map((s) => s.id),
        )
      : undefined;
    return {
      ...result,
      items: ServiceMapper.toResponseList(result.items, favoriteIds),
    };
  }

  @Get(':slug')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Public service detail by slug (supports If-Modified-Since)',
  })
  @ApiParam({ name: 'slug', description: 'URL slug derived from the service name' })
  @ApiResponse({ status: 200, type: ServiceResponseDto })
  @ApiResponse({ status: 304, description: 'Not modified since If-Modified-Since' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findBySlug(
    @Param('slug') slug: string,
    @CurrentUser() user: AppUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ServiceResponseDto | undefined> {
    const service = await this.servicesService.findBySlug(slug);
    const lastModified = service.updatedAt;
    res.set('Last-Modified', lastModified.toUTCString());
    res.set('Cache-Control', PUBLIC_CACHE);

    const ims = req.headers['if-modified-since'];
    if (ims && !this.isModifiedSince(ims, lastModified)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    const isFavorite = user
      ? (
          await this.servicesService.favoritedServiceIds(user.id, [service.id])
        ).has(service.id)
      : undefined;
    return ServiceMapper.toResponse(
      service,
      isFavorite !== undefined ? { isFavorite } : undefined,
    );
  }

  @Get(':id/related')
  @Public()
  @ApiOperation({
    summary: 'Active services in the same category (excludes the service itself)',
  })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiOkResponse({ type: ServiceResponseDto, isArray: true })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async findRelated(
    @Param('id', ParseObjectIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', PUBLIC_CACHE);
    const related = await this.servicesService.findRelated(id);
    return ServiceMapper.toResponseList(related);
  }

  @Post()
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Create a service — slug auto-derived from name and immutable',
  })
  @ApiResponse({ status: 201, type: ServiceResponseDto })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  async create(@Body() dto: CreateServiceDto) {
    return ServiceMapper.toResponse(await this.servicesService.create(dto));
  }

  @Patch(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update a service — slug is immutable' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: ServiceResponseDto })
  @ApiResponse({ status: 404, description: 'Service not found' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return ServiceMapper.toResponse(await this.servicesService.update(id, dto));
  }

  @Delete(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a service' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 204, description: 'Service deleted' })
  @ApiResponse({ status: 404, description: 'Service not found' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.servicesService.remove(id);
  }

  /** True if the resource changed after the client's If-Modified-Since (second precision). */
  private isModifiedSince(header: string, lastModified: Date): boolean {
    const since = Date.parse(header);
    if (Number.isNaN(since)) return true;
    return Math.floor(lastModified.getTime() / 1000) * 1000 > since;
  }
}
