import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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
  @IsOptional() @IsBoolean() featured?: boolean;
  @IsOptional() @IsBoolean() bestSeller?: boolean;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsUUID() subcategoryId?: string;
}
