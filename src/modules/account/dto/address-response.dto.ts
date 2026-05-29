import { Expose, Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@Exclude()
export class AddressResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() street!: string;
  @ApiProperty() @Expose() city!: string;
  @ApiProperty() @Expose() state!: string;
  @ApiProperty() @Expose() zipCode!: string;
  @ApiProperty() @Expose() country!: string;
  @ApiProperty() @Expose() isDefault!: boolean;
  // userId excluded
}
