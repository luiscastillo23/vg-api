import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { LedgerType, PaymentMethod } from '../../../../generated/prisma/enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class TopUpBalanceDto {
  @Type(() => Number) @IsNumber() @Min(1) amount!: number;
  @IsEnum(PaymentMethod) paymentMethod!: PaymentMethod;
}
export class AdjustBalanceDto {
  @IsEnum(LedgerType) type!: LedgerType;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsString() reason!: string;
}
export class LedgerQueryDto extends PaginationDto {
  @IsOptional() @IsEnum(LedgerType) type?: LedgerType;
}
