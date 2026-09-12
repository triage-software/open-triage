import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { ZodError } from 'zod';
import { Request, Response } from 'express';

/**
 * QA-2: schema-validation failures (ZodError thrown from service/controller
 * `.parse()` calls) must surface as HTTP 400 with a structured body, never
 * as a Nest 500 "Internal server error".
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ZodExceptionFilter');

  catch(exception: ZodError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const first = exception.issues[0];
    this.logger.warn(
      `${req.method} ${req.url} → 400 VALIDATION_ERROR (${exception.issues.length} issue(s))`,
    );
    res.status(HttpStatus.BAD_REQUEST).json({
      code: 'VALIDATION_ERROR',
      message: first
        ? `${first.path.join('.') || 'body'}: ${first.message}`
        : 'Validation failed',
      errors: exception.issues.map((i) => ({
        path: i.path.join('.'),
        code: i.code,
        message: i.message,
      })),
    });
  }
}
