import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
export class CreateRefundDto {
  @IsUUID() orderId!: string;
  @Type(() => Number) @IsNumber() @Min(0.01) amount!: number;
  @IsString() reason!: string;
  @IsOptional() @IsBoolean() isChargeback?: boolean;
}
