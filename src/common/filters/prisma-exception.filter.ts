import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import type { ErrorEnvelope } from './all-exceptions.filter';

const STATUS_BY_CODE: Record<string, number> = {
  P2002: HttpStatus.CONFLICT,
  P2025: HttpStatus.NOT_FOUND,
  P2003: HttpStatus.CONFLICT,
};

const MESSAGE_BY_CODE: Record<string, (e: PrismaClientKnownRequestError) => string> = {
  P2002: (e) => {
    const target = (e.meta?.target as string[] | string | undefined) ?? 'field';
    const fields = Array.isArray(target) ? target.join(', ') : target;
    return `Duplicate value for ${fields}`;
  },
  P2025: () => 'Record not found',
  P2003: (e) => {
    const field = (e.meta?.field_name as string | undefined) ?? 'foreign key';
    return `Foreign key violation on ${field}`;
  },
};

@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status: (n: number) => { json: (b: unknown) => void } }>();
    const req = http.getRequest<{ url?: string; originalUrl?: string }>();
    const path = req.originalUrl ?? req.url ?? '';

    const statusCode = STATUS_BY_CODE[exception.code] ?? HttpStatus.CONFLICT;
    const message = (MESSAGE_BY_CODE[exception.code] ?? (() => 'Database error'))(exception);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Prisma ${exception.code} on ${path}`, exception.stack);
    }

    const envelope: ErrorEnvelope = {
      success: false,
      statusCode,
      timestamp: new Date().toISOString(),
      path,
      error: { message },
      code: exception.code,
    };

    res.status(statusCode).json(envelope);
  }
}
