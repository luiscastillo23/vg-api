import { IsIn, IsString } from 'class-validator';
export class SignUploadDto {
  @IsString() filename!: string;
  @IsIn(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
  contentType!: string;
}
