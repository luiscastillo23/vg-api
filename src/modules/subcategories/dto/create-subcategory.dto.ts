import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
export class CreateSubcategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsString() @IsNotEmpty() categoryId!: string;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
