import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ItemKind } from '../../../../generated/prisma/enums';
export class AddFavoriteDto {
  @IsEnum(ItemKind) kind!: ItemKind;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() serviceId?: string;
}
