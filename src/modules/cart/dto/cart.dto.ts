import { IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { ItemKind } from '../../../../generated/prisma/enums';
export class AddCartItemDto {
  @IsEnum(ItemKind) kind!: ItemKind;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsInt() @Min(1) quantity!: number;
}
export class UpdateCartItemDto {
  @IsInt() @Min(1) quantity!: number;
}
