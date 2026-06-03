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

/** Public catalog sort keys — mirrors ProductSort minus `rating` (Service has no rating field). */
export enum ServiceSort {
  POPULARITY = 'popularity',
  PRICE_ASC = 'priceAsc',
  PRICE_DESC = 'priceDesc',
  NEWEST = 'newest',
}

export class ServiceQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Scope to a category (cuid).' })
  @IsOptional() @IsString() categoryId?: string;

  @ApiPropertyOptional({ description: 'Scope to a subcategory (cuid).' })
  @IsOptional() @IsString() subcategoryId?: string;

  @ApiPropertyOptional({ description: 'Inclusive lower bound on base price.' })
  @IsOptional() @Type(() => Number) @IsNumber() minPrice?: number;

  @ApiPropertyOptional({ description: 'Inclusive upper bound on base price.' })
  @IsOptional() @Type(() => Number) @IsNumber() maxPrice?: number;

  @ApiPropertyOptional({ description: 'Only best-seller services when true.' })
  @IsOptional() @Type(() => Boolean) @IsBoolean() bestSeller?: boolean;

  @ApiPropertyOptional({ description: 'Only services with a sale price set when true.' })
  @IsOptional() @Type(() => Boolean) @IsBoolean() onSale?: boolean;

  @ApiPropertyOptional({ enum: EntityStatus, description: 'Filter by lifecycle status.' })
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;

  @ApiPropertyOptional({ enum: ServiceSort, default: ServiceSort.POPULARITY })
  @IsOptional() @IsEnum(ServiceSort) sort?: ServiceSort;
}
