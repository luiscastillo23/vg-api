import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationType } from '../../../../generated/prisma/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class NotificationQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(NotificationType) type?: NotificationType;
  @IsOptional() @Type(() => Boolean) @IsBoolean() read?: boolean;
}
