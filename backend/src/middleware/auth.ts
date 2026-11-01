import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/index.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

// In-memory principal store for authentication tokens
const KNOWN_TOKENS = new Map<string, AuthenticatedUser>([
  ['test-user-token', { id: 'usr_test_123', email: 'alice@example.com', role: 'user' }],
  ['test-user-2-token', { id: 'usr_test_456', email: 'bob@example.com', role: 'user' }],
  ['test-admin-token', { id: 'usr_admin_999', email: 'admin@intentguard.security', role: 'admin' }],
]);

export function registerAuthToken(token: string, user: AuthenticatedUser): void {
  KNOWN_TOKENS.set(token, user);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing or malformed Authorization header. Expected Bearer token.');
  }

  const token = authHeader.substring(7).trim();
  const user = KNOWN_TOKENS.get(token);

  if (!user) {
    throw AppError.unauthorized('Invalid or expired authentication credentials.');
  }

  // Bind authenticated principal strictly to req.user
  req.user = user;
  next();
}

export function requireRole(role: 'admin' | 'user') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw AppError.unauthorized();
    }
    if (req.user.role !== role && req.user.role !== 'admin') {
      throw AppError.forbidden(`Required role '${role}' not satisfied.`);
    }
    next();
  };
}
