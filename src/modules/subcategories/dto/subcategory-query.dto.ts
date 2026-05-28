import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
export class SubcategoryQueryDto extends PaginationDto {
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
