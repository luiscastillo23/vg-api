import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
export class AdjustStockDto {
  @Type(() => Number) @IsInt() delta!: number; // positive or negative
  @IsOptional() @IsString() reason?: string;
}
