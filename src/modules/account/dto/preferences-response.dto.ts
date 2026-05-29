import { Expose, Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

@Exclude()
export class PreferencesResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() notifications!: boolean;
  @ApiProperty() @Expose() marketing!: boolean;
  @ApiProperty() @Expose() theme!: string;
  @ApiProperty() @Expose() language!: string;
  // userId excluded
}
