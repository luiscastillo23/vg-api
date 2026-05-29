import { Injectable, PipeTransform } from '@nestjs/common';

function trimDeep(value: unknown): unknown {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(trimDeep);
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, trimDeep(v)]));
  }
  return value;
}

@Injectable()
export class TrimPipe implements PipeTransform {
  transform(value: unknown): unknown {
    return trimDeep(value);
  }
}
