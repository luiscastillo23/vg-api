import { IsArray, IsOptional, IsString } from 'class-validator';
export class CreateMessageDto {
  @IsString() body!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) attachments?: string[];
}
