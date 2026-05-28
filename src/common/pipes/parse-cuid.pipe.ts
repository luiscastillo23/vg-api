import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const CUID_REGEX = /^c[a-z0-9]{24}$/;
const CUID2_REGEX = /^[a-z][a-z0-9]{23,31}$/;

@Injectable()
export class ParseCuidPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || (!CUID_REGEX.test(value) && !CUID2_REGEX.test(value))) {
      throw new BadRequestException('Invalid CUID');
    }
    return value;
  }
}
