import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
export class CreateSubcategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsUUID() categoryId!: string;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
