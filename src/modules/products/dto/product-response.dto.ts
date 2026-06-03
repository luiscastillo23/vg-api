import { Exclude, Expose } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EntityStatus } from '../../../../generated/prisma/enums';

@Exclude()
export class ProductResponseDto {
  @Expose() @ApiProperty() id: string;
  @Expose() @ApiProperty() name: string;
  @Expose() @ApiProperty() slug: string;
  @Expose() @ApiProperty() description: string;
  @Expose() @ApiProperty() sku: string;

  // Money is serialized as a fixed-precision string to avoid JS float drift.
  @Expose() @ApiProperty({ example: '19.99', description: 'Base price (decimal string).' })
  price: string;
  @Expose() @ApiProperty({ nullable: true, example: '14.99', description: 'Sale price (decimal string) or null.' })
  salePrice: string | null;
  @Expose() @ApiProperty({ description: 'True when a sale price is set.' })
  onSale: boolean;

  @Expose() @ApiProperty() stock: number;
  @Expose() @ApiProperty({ type: [String] }) images: string[];
  @Expose() @ApiProperty({ type: [String] }) tags: string[];
  @Expose() @ApiProperty() popularity: number;
  @Expose() @ApiProperty({ description: 'Denormalized average review rating.' })
  rating: number;
  @Expose() @ApiProperty() featured: boolean;
  @Expose() @ApiProperty() bestSeller: boolean;
  @Expose() @ApiProperty({ enum: EntityStatus }) status: EntityStatus;
  @Expose() @ApiProperty() categoryId: string;
  @Expose() @ApiProperty({ nullable: true }) subcategoryId: string | null;

  @Expose() @ApiProperty({ required: false, description: 'Present only on authenticated requests.' })
  isFavorite?: boolean;

  @Expose() @ApiProperty() createdAt: Date;
  @Expose() @ApiProperty() updatedAt: Date;
}
