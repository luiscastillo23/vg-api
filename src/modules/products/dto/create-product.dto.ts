import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { EntityStatus } from '../../../../generated/prisma/enums';

export class CreateProductDto {
  @IsString() name!: string;
  @IsString() description!: string;
  @IsString() sku!: string;
  @Type(() => Number) @IsNumber() @Min(0) price!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salePrice?: number;
  @Type(() => Number) @IsNumber() @Min(0) stock!: number;
  @IsArray() @IsString({ each: true }) images!: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsBoolean() bestSeller?: boolean;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
  // IDs are cuid()s, not UUIDs — validate as non-empty strings (see ParseObjectIdPipe).
  @IsString() @IsNotEmpty() categoryId!: string;
  @IsOptional() @IsString() @IsNotEmpty() subcategoryId?: string;
}
