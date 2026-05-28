import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
import { Type } from 'class-transformer';
export class ProductQueryDto extends PaginationDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() subcategoryId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() minPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maxPrice?: number;
  @IsOptional() @Type(() => Boolean) @IsBoolean() featured?: boolean;
  @IsOptional() @Type(() => Boolean) @IsBoolean() bestSeller?: boolean;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
