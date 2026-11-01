import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config/index.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { errorHandler } from './errors/index.js';
import { healthRouter } from './routes/health.js';
import { intentsRouter } from './routes/intents.js';
import { createOrdersRouter } from './routes/orders.js';
import { auditRouter } from './routes/audit.js';
import { createAgentRouter } from './routes/agent.js';
import { catalogueRouter } from './routes/catalogue.js';
import { PaymentProvider } from './payment/types.js';
import { MockPaymentProvider } from './payment/mockAdapter.js';
import { PayPalSandboxAdapter } from './payment/paypalAdapter.js';
import { GuardedCaptureService } from './payment/guardedCapture.js';
import { getDbClient } from './db/client.js';

export interface AppDependencies {
  paymentProvider?: PaymentProvider;
  guardedCaptureService?: GuardedCaptureService;
}

export function createApp(deps?: AppDependencies): Express {
  const app = express();

  // Security Headers
  app.use(helmet());

  // CORS Configuration
  app.use(
    cors({
      origin: config.CORS_ORIGIN === '*' ? true : config.CORS_ORIGIN,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'Idempotency-Key', 'x-idempotency-key'],
      credentials: true,
    })
  );

  // Request correlation IDs
  app.use(requestIdMiddleware);

  // Body Parsing with strict JSON size limits
  app.use(express.json({ limit: '100kb' }));

  // Initialize Payment Provider & Guarded Capture Service
  const db = getDbClient();
  const provider =
    deps?.paymentProvider ||
    (config.NODE_ENV === 'test' || config.PAYPAL_CLIENT_ID.includes('placeholder')
      ? new MockPaymentProvider()
      : new PayPalSandboxAdapter());

  const guardedCaptureService =
    deps?.guardedCaptureService || new GuardedCaptureService(db, provider);

  // Mount Routes
  app.use('/health', healthRouter);
  app.use('/api/intents', intentsRouter);
  app.use('/api/orders', createOrdersRouter(provider, guardedCaptureService));
  app.use('/api/audit', auditRouter);
  app.use('/api/agent', createAgentRouter());
  app.use('/api/catalogue', catalogueRouter);

  // Centralized Error Handler
  app.use(errorHandler);

  return app;
}
