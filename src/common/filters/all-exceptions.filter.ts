import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

export interface ErrorEnvelope {
  success: false;
  statusCode: number;
  timestamp: string;
  path: string;
  error: { message: string; details?: unknown };
  code?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status: (n: number) => { json: (b: unknown) => void } }>();
    const req = http.getRequest<{ url?: string; originalUrl?: string }>();
    const path = req.originalUrl ?? req.url ?? '';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: unknown;
    let code: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: unknown; error?: string; details?: unknown };
        if (Array.isArray(b.message)) {
          message = b.error ?? 'Validation failed';
          details = b.message;
        } else if (typeof b.message === 'string') {
          message = b.message;
          details = b.details;
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`${statusCode} ${path}`, exception instanceof Error ? exception.stack : exception);
    }

    const envelope: ErrorEnvelope = {
      success: false,
      statusCode,
      timestamp: new Date().toISOString(),
      path,
      error: { message, ...(details !== undefined ? { details } : {}) },
      ...(code ? { code } : {}),
    };

    res.status(statusCode).json(envelope);
  }
}
