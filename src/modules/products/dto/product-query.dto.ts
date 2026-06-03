import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EntityStatus } from '../../../../generated/prisma/enums';

/** Public catalog sort keys. Each maps to a deterministic orderBy in the repository. */
export enum ProductSort {
  POPULARITY = 'popularity',
  PRICE_ASC = 'priceAsc',
  PRICE_DESC = 'priceDesc',
  NEWEST = 'newest',
  RATING = 'rating',
}

export class ProductQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Scope to a category (cuid).' })
  @IsOptional() @IsString() categoryId?: string;

  @ApiPropertyOptional({ description: 'Scope to a subcategory (cuid).' })
  @IsOptional() @IsString() subcategoryId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on base price.' })
  @IsOptional() @Type(() => Number) @IsNumber() minPrice?: number;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on base price.' })
  @IsOptional() @Type(() => Number) @IsNumber() maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only featured products when true.' })
  @IsOptional() @Type(() => Boolean) @IsBoolean() featured?: boolean;

  @ApiPropertyOptional({ description: 'Only best-seller products when true.' })
  @IsOptional() @Type(() => Boolean) @IsBoolean() bestSeller?: boolean;

  @ApiPropertyOptional({ description: 'Only products with a sale price set when true.' })
  @IsOptional() @Type(() => Boolean) @IsBoolean() onSale?: boolean;

  @ApiPropertyOptional({ description: 'Match products carrying this exact tag.' })
  @IsOptional() @IsString() tag?: string;

  @ApiPropertyOptional({ enum: EntityStatus, description: 'Filter by lifecycle status.' })
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;

  @ApiPropertyOptional({ enum: ProductSort, default: ProductSort.POPULARITY })
  @IsOptional() @IsEnum(ProductSort) sort?: ProductSort;
}
