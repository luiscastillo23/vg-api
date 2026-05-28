import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<{ method: string; url: string; originalUrl?: string }>();
    const res = http.getResponse<{ statusCode: number }>();
    const start = process.hrtime.bigint();
    const method = req.method;
    const path = req.originalUrl ?? req.url;

    return next.handle().pipe(
      tap({
        next: () => this.log(method, path, res.statusCode, start),
        error: (err: { status?: number }) => this.log(method, path, err?.status ?? 500, start),
      }),
    );
  }

  private log(method: string, path: string, status: number, start: bigint) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    this.logger.log(`${method} ${path} ${status} ${latencyMs.toFixed(1)}ms`);
  }
}
