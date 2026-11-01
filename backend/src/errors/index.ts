import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger/index.js';

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNPROCESSABLE_ENTITY'
  | 'POLICY_REJECTED'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(statusCode: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static unauthorized(message: string = 'Authentication required'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message: string = 'Access denied'): AppError {
    return new AppError(403, 'FORBIDDEN', message);
  }

  static notFound(message: string = 'Resource not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'CONFLICT', message, details);
  }

  static policyRejected(message: string, details?: unknown): AppError {
    return new AppError(422, 'POLICY_REJECTED', message, details);
  }

  static providerError(message: string, details?: unknown): AppError {
    return new AppError(502, 'PROVIDER_ERROR', message, details);
  }

  static providerTimeout(message: string, details?: unknown): AppError {
    return new AppError(504, 'PROVIDER_TIMEOUT', message, details);
  }

  static internal(message: string = 'An unexpected internal error occurred'): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message);
  }
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const requestId = (req.headers['x-request-id'] as string) || (req as unknown as { id?: string }).id || 'unknown';

  if (err instanceof AppError) {
    logger.warn(`API Error [${err.code}]: ${err.message}`, {
      requestId,
      statusCode: err.statusCode,
      code: err.code,
      path: req.path,
      method: req.method,
      details: err.details,
    });

    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Fallback for unhandled/unexpected errors
  const message = err instanceof Error ? err.message : 'Unknown error';
  logger.error(`Unhandled Exception: ${message}`, {
    requestId,
    path: req.path,
    method: req.method,
    stack: err instanceof Error ? err.stack : undefined,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected internal error occurred',
      requestId,
    },
  });
}
