import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { ItemKind } from '../../../../generated/prisma/enums';

export type Granularity = 'day' | 'week' | 'month' | 'year';

export class ReportQueryDto {
  @IsOptional() @IsString() from?: string; // ISO date
  @IsOptional() @IsString() to?: string;
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  granularity: Granularity = 'month';
  @IsOptional() @IsEnum(ItemKind) kind?: ItemKind;
}
