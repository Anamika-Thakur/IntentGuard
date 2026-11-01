export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'token',
  'access_token',
  'client_secret',
  'secret',
  'password',
  'card_number',
  'cvv',
  'hmac_key',
  'auth_hmac_secret_key_v1',
  'paypal_client_secret',
]);

export function redactSensitiveData(obj: unknown, depth = 0): unknown {
  if (depth > 6 || obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Redact bearer tokens or hex secrets if embedded in strings
    return obj.replace(/Bearer\s+[A-Za-z0-9-_.]+/gi, 'Bearer [REDACTED]');
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, depth + 1));
  }

  if (typeof obj === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lower) || lower.includes('secret') || lower.includes('password') || lower.includes('token')) {
        copy[key] = '[REDACTED]';
      } else {
        copy[key] = redactSensitiveData(value, depth + 1);
      }
    }
    return copy;
  }

  return obj;
}

export class Logger {
  constructor(private context: string = 'IntentGuard') {}

  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const sanitizedMeta = meta ? redactSensitiveData(meta) : undefined;
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      context: this.context,
      message,
      ...(sanitizedMeta && typeof sanitizedMeta === 'object' ? sanitizedMeta : {}),
    };

    if (process.env.NODE_ENV === 'test') {
      // In test mode, keep noise minimal unless DEBUG=true
      if (process.env.DEBUG === 'true' || level === 'error') {
        // eslint-disable-next-line no-console
        console.error(JSON.stringify(logEntry));
      }
      return;
    }

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(logEntry));
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  child(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`);
  }
}

export const logger = new Logger('App');
