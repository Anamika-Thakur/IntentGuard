import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/index.js';

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; message?: string }) {
  const store = new Map<string, RateLimitRecord>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    // In test environment, bypass rate limits unless specifically testing rate limiter
    if (process.env.NODE_ENV === 'test' && !req.headers['x-test-rate-limit']) {
      return next();
    }

    const key = req.user?.id || req.ip || 'anonymous';
    const now = Date.now();
    const record = store.get(key);

    if (!record || now >= record.resetAt) {
      store.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (record.count >= options.max) {
      throw new AppError(
        429,
        'RATE_LIMITED',
        options.message || 'Too many requests. Please slow down and try again later.'
      );
    }

    record.count += 1;
    next();
  };
}
