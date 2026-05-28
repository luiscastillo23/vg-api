import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
export class CreateCategoryDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
