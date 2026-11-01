import { Router, Request, Response } from 'express';
import { getDbClient } from '../db/client.js';

export const healthRouter = Router();

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: process.uptime(),
  });
});

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    const db = getDbClient();
    const dbAlive = await db.isReady();

    if (!dbAlive) {
      res.status(503).json({
        status: 'degraded',
        database: 'unreachable',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      status: 'ready',
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(503).json({
      status: 'unavailable',
      error: err instanceof Error ? err.message : 'Readiness check failed',
      timestamp: new Date().toISOString(),
    });
  }
});
