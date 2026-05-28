import { PartialType, OmitType } from '@nestjs/mapped-types';
export class UpdateUserDto extends PartialType(
  OmitType(CreateUserDto, ['password'] as const),
) {}
