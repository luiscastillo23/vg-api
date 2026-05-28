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
import { EntityStatus } from '../../../../generated/prisma/enums';
import { Type } from 'class-transformer';
export class CreateServiceDto {
  @IsString() name!: string;
  @IsString() description!: string;
  @Type(() => Number) @IsNumber() @Min(0) price!: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salePrice?: number;
  @Type(() => Number) @IsNumber() @Min(0) capacity!: number;
  @IsArray() @IsString({ each: true }) images!: string[];
  @IsOptional() @IsBoolean() bestSeller?: boolean;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsUUID() subcategoryId?: string;
}
