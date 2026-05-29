import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

const CUID2_REGEX = /^[a-z][a-z0-9]{23,31}$/;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value === 'string' && (CUID2_REGEX.test(value) || UUID_V4_REGEX.test(value))) {
      return value;
    }
    throw new BadRequestException('Invalid ID');
  }
}
