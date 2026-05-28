import { OrderStatus } from '../../../../generated/prisma/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { IsOptional, IsString, IsEnum } from 'class-validator';
export class OrderQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() from?: string; // ISO date
  @IsOptional() @IsString() to?: string;
}
export class UpdateOrderStatusDto {
  @IsEnum(OrderStatus) status!: OrderStatus;
}
