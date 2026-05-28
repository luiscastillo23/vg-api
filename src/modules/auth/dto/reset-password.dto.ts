import { IsEmail, IsString, MinLength } from 'class-validator';

export class RequestResetPasswordDto {
  @IsEmail() email: string;
}
export class ConfirmResetPasswordDto {
  @IsString() token: string;
  @IsString() @MinLength(8) newPassword: string;
}
