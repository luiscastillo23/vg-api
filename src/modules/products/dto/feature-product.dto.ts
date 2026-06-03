import { IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class FeatureProductDto {
  @ApiProperty({ description: 'Set (true) or clear (false) the featured flag.' })
  @IsBoolean()
  featured!: boolean;
}
