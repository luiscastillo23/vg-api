import { Expose, Exclude } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EntityStatus } from '../../../../generated/prisma/enums';

@Exclude()
export class SubcategoryResponseDto {
  @Expose() @ApiProperty() id: string;
  @Expose() @ApiProperty() name: string;
  @Expose() @ApiProperty() slug: string;
  @Expose() @ApiProperty({ nullable: true }) description: string | null;
  @Expose() @ApiProperty() categoryId: string;
  @Expose() @ApiProperty({ enum: EntityStatus }) status: EntityStatus;
  @Expose() @ApiProperty() createdAt: Date;
  @Expose() @ApiProperty() updatedAt: Date;
}
