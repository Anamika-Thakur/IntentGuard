import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { redactSensitiveData } from '../src/logger/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { getDbClient } from '../src/db/client.js';

describe('Phase 1: Backend Foundation and Configuration', () => {
  const app = createApp();

  beforeAll(async () => {
    await runMigrations();
  });

  describe('Configuration Validation', () => {
    it('loads valid default development configuration', () => {
      const cfg = loadConfig({
        NODE_ENV: 'test',
        PORT: '4000',
        AUTH_HMAC_SECRET_KEY_V1: 'a_very_long_secret_key_exceeding_32_characters_for_hmac',
      });
      expect(cfg.PORT).toBe(4000);
      expect(cfg.NODE_ENV).toBe('test');
    });

    it('rejects PayPal production environment in sandbox engine', () => {
      expect(() => {
        loadConfig({
          PAYPAL_ENV: 'production',
        });
      }).toThrow(/disallowed in IntentGuard/i);
    });

    it('rejects short HMAC secrets (<32 chars)', () => {
      expect(() => {
        loadConfig({
          AUTH_HMAC_SECRET_KEY_V1: 'too_short',
        });
      }).toThrow(/at least 32 characters/i);
    });
  });

  describe('Health Endpoints', () => {
    it('GET /health/live returns 200 with status ok and uptime', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ok');
      expect(res.body).toHaveProperty('uptimeSeconds');
      expect(res.headers['x-request-id']).toBeDefined();
    });

    it('GET /health/ready returns 200 with connected database status', async () => {
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('status', 'ready');
      expect(res.body).toHaveProperty('database', 'connected');
    });
  });

  describe('Security Headers & Middleware', () => {
    it('applies helmet security headers', async () => {
      const res = await request(app).get('/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('propagates or generates x-request-id correlation header', async () => {
      const customId = 'req-trace-custom-999';
      const res = await request(app).get('/health/live').set('x-request-id', customId);
      expect(res.headers['x-request-id']).toBe(customId);
    });
  });

  describe('Sensitive Field Redaction in Logger', () => {
    it('redacts tokens, passwords, secrets, and auth headers', () => {
      const raw = {
        user: 'alice',
        password: 'my-super-secret-password',
        auth_token: 'secret_jwt_token',
        nested: {
          client_secret: 'paypal_client_secret_xyz',
          normalField: 42,
        },
      };

      const redacted = redactSensitiveData(raw) as Record<string, unknown>;
      expect(redacted['password']).toBe('[REDACTED]');
      expect(redacted['auth_token']).toBe('[REDACTED]');
      expect((redacted['nested'] as Record<string, unknown>)['client_secret']).toBe('[REDACTED]');
      expect((redacted['nested'] as Record<string, unknown>)['normalField']).toBe(42);
    });
  });

  describe('Database Connection and Migrations', () => {
    it('migrates and can query seeded merchants and catalogue products', async () => {
      const db = getDbClient();
      const merchants = await db.query('SELECT * FROM merchants WHERE merchant_id = $1', ['MERCHANT_ACME_STORE']);
      expect(merchants.rowCount).toBe(1);
      expect(merchants.rows[0]?.name).toBe('Acme Store Official');

      const products = await db.query('SELECT * FROM catalogue_products WHERE sku = $1', ['SKU-WIDGET-01']);
      expect(products.rowCount).toBe(1);
      expect(products.rows[0]?.unit_price_cents).toBe(2500);
      expect(products.rows[0]?.currency).toBe('USD');
    });
  });
});
