import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { isPaginatedResult } from '../utils/paginate';

export interface ResponseEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ResponseEnvelope<unknown>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ResponseEnvelope<unknown>> {
    return next.handle().pipe(
      map((payload): ResponseEnvelope<unknown> => {
        if (isPaginatedResult(payload)) {
          const { items, total, page, limit, pages, hasNext } = payload;
          return { success: true, data: items, meta: { total, page, limit, pages, hasNext } };
        }
        return { success: true, data: payload };
      }),
    );
  }
}
