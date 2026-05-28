import { IsEmail, IsString, MinLength, Matches } from 'class-validator';
export class SignUpDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) firstName: string;
  @IsString() @MinLength(2) lastName: string;
  @IsString()
  @MinLength(8)
  @Matches(/(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/, {
    message: 'Password must include uppercase, number and symbol',
  })
  password: string;
}
