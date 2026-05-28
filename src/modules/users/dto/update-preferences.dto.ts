import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
export class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() notifications?: boolean;
  @IsOptional() @IsBoolean() marketing?: boolean;
  @IsOptional() @IsIn(['light', 'dark', 'system']) theme?:
    | 'light'
    | 'dark'
    | 'system';
  @IsOptional() @IsString() language?: string;
}
