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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { FeatureProductDto } from './dto/feature-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductMapper } from './mappers/product.mapper';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AppUser } from '../../common/decorators/current-user.decorator';
import { OptionalAuthGuard } from '../auth/guards/optional-auth.guard';
import { Role } from '../../../generated/prisma/enums';

const PUBLIC_CACHE = 'public, max-age=60';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Public product catalog — paginated, filterable, sortable',
    description: [
      'All filters are optional and **AND-combined** — every filter you pass must match.',
      '',
      '- `search`: case-insensitive match across name, description, and SKU.',
      '- `status`: lifecycle filter (omit to list every status; pass `ACTIVE` for the live catalog).',
      '- `minPrice` / `maxPrice`: inclusive bounds on the **base** price (not the sale price).',
      '- `featured` / `bestSeller` / `onSale`: boolean flags; `onSale=true` means a sale price is set.',
      '- `categoryId` / `subcategoryId`: scope to a catalog branch.',
      '- `tag`: products carrying the exact tag.',
      '- `sort`: popularity | priceAsc | priceDesc | newest | rating (default: popularity).',
      '',
      'Authenticated callers additionally receive `isFavorite` on each product.',
      'Prefer query flags (e.g. `?onSale=true`) over dedicated sub-paths.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: ProductResponseDto, isArray: true })
  async findAll(
    @Query() query: ProductQueryDto,
    @CurrentUser() user: AppUser | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', PUBLIC_CACHE);
    const result = await this.productsService.findAll(query);
    const favoriteIds = user
      ? await this.productsService.favoritedProductIds(
          user.id,
          result.items.map((p) => p.id),
        )
      : undefined;
    return {
      ...result,
      items: ProductMapper.toResponseList(result.items, favoriteIds),
    };
  }

  @Get(':slug')
  @Public()
  @UseGuards(OptionalAuthGuard)
  @ApiOperation({
    summary: 'Public product detail by slug (supports If-Modified-Since)',
  })
  @ApiParam({ name: 'slug', description: 'URL slug derived from the product name' })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  @ApiResponse({ status: 304, description: 'Not modified since If-Modified-Since' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findBySlug(
    @Param('slug') slug: string,
    @CurrentUser() user: AppUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ProductResponseDto | undefined> {
    const product = await this.productsService.findBySlug(slug);
    const lastModified = product.updatedAt;
    res.set('Last-Modified', lastModified.toUTCString());
    res.set('Cache-Control', PUBLIC_CACHE);

    const ims = req.headers['if-modified-since'];
    if (ims && !this.isModifiedSince(ims, lastModified)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }

    const isFavorite = user
      ? (
          await this.productsService.favoritedProductIds(user.id, [product.id])
        ).has(product.id)
      : undefined;
    return ProductMapper.toResponse(
      product,
      isFavorite !== undefined ? { isFavorite } : undefined,
    );
  }

  @Get(':id/related')
  @Public()
  @ApiOperation({
    summary: 'Active products in the same category (excludes the product itself)',
  })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiOkResponse({ type: ProductResponseDto, isArray: true })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async findRelated(
    @Param('id', ParseObjectIdPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', PUBLIC_CACHE);
    const related = await this.productsService.findRelated(id);
    return ProductMapper.toResponseList(related);
  }

  @Post()
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Create a product — slug auto-derived from name and immutable',
  })
  @ApiResponse({ status: 201, type: ProductResponseDto })
  @ApiResponse({ status: 409, description: 'Slug or SKU already in use' })
  async create(@Body() dto: CreateProductDto) {
    return ProductMapper.toResponse(await this.productsService.create(dto));
  }

  @Patch(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary:
      'Update a product — slug & SKU immutable; stock only via /adjust-stock',
  })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 200, type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return ProductMapper.toResponse(await this.productsService.update(id, dto));
  }

  @Delete(':id')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a product' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 204, description: 'Product deleted' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.productsService.remove(id);
  }

  @Post(':id/adjust-stock')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({
    summary: 'Atomically adjust stock by a signed delta (the only way to change stock)',
  })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 201, type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Adjustment would drive stock negative' })
  async adjustStock(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AdjustStockDto,
  ) {
    return ProductMapper.toResponse(
      await this.productsService.adjustStock(id, dto),
    );
  }

  @Post(':id/feature')
  @ApiBearerAuth('clerk')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Set or clear the featured flag' })
  @ApiParam({ name: 'id', description: 'CUID2 or UUID v4' })
  @ApiResponse({ status: 201, type: ProductResponseDto })
  @ApiResponse({ status: 404, description: 'Product not found' })
  async feature(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FeatureProductDto,
  ) {
    return ProductMapper.toResponse(
      await this.productsService.setFeatured(id, dto.featured),
    );
  }

  /** True if the resource changed after the client's If-Modified-Since (second precision). */
  private isModifiedSince(header: string, lastModified: Date): boolean {
    const since = Date.parse(header);
    if (Number.isNaN(since)) return true; // unparseable header -> treat as modified
    // HTTP dates carry second precision; floor lastModified before comparing.
    return Math.floor(lastModified.getTime() / 1000) * 1000 > since;
  }
}
