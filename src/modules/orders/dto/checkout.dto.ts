import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../../generated/prisma/enums';

export class ShippingInfoDto {
  @IsString() fullName!: string;
  @IsString() street!: string;
  @IsString() city!: string;
  @IsString() state!: string;
  @IsString() zipCode!: string;
  @IsString() country!: string;
  @IsOptional() @IsString() phone?: string;
}
export class CheckoutDto {
  @IsEnum(PaymentMethod) paymentMethod!: PaymentMethod;
  @ValidateNested() @Type(() => ShippingInfoDto) shipping!: ShippingInfoDto;
  @IsOptional() @IsBoolean() useBalance?: boolean;
  @IsOptional() @IsString() couponCode?: string;
  @IsOptional() @IsString() notes?: string;
}
