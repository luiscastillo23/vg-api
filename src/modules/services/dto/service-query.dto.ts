import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsOptional, IsString, IsBoolean, IsEnum } from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
import { Type } from 'class-transformer';
export class ServiceQueryDto extends PaginationDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() subcategoryId?: string;
  @IsOptional() @Type(() => Boolean) @IsBoolean() bestSeller?: boolean;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
