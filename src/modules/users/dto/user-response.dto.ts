import { Expose, Exclude } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role, UserStatus } from '../../../../generated/prisma/enums';

@Exclude()
export class UserResponseDto {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() email!: string;
  @ApiProperty() @Expose() firstName!: string;
  @ApiProperty() @Expose() lastName!: string;
  @ApiProperty({ enum: Role }) @Expose() role!: Role;
  @ApiProperty({ enum: UserStatus }) @Expose() status!: UserStatus;
  @ApiPropertyOptional() @Expose() avatar!: string | null;
  @ApiPropertyOptional() @Expose() phone!: string | null;
  @ApiPropertyOptional() @Expose() emailVerifiedAt!: Date | null;
  @ApiPropertyOptional() @Expose() lastLogin!: Date | null;
  @ApiProperty() @Expose() createdAt!: Date;
  @ApiProperty() @Expose() updatedAt!: Date;
  // clerkId and passwordHash are intentionally excluded
}
