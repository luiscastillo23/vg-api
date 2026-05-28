import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
export class CreateAddressDto {
  @IsString() street!: string;
  @IsString() city!: string;
  @IsString() state!: string;
  @IsString() zipCode!: string;
  @IsString() country!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}
