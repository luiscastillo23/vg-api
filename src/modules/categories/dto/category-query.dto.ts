import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsEnum, IsOptional } from 'class-validator';
import { EntityStatus } from '../../../../generated/prisma/enums';
export class CategoryQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(EntityStatus) status?: EntityStatus;
}
