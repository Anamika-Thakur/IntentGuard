import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { getDbClient } from '../db/client.js';
import { AppError } from '../errors/index.js';

export const auditRouter = Router();
const db = getDbClient();

auditRouter.use(requireAuth);

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * GET /api/audit
 * Returns paginated, user-scoped audit records.
 */
auditRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, limit } = querySchema.parse(req.query);
    const userId = req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    const offset = (page - 1) * limit;

    let rowsQuery: string;
    let countQuery: string;
    let params: unknown[];

    if (isAdmin) {
      rowsQuery = `SELECT * FROM audit_events ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
      countQuery = `SELECT COUNT(*) as total FROM audit_events`;
      params = [limit, offset];
    } else {
      rowsQuery = `SELECT * FROM audit_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`;
      countQuery = `SELECT COUNT(*) as total FROM audit_events WHERE user_id = $1`;
      params = [userId, limit, offset];
    }

    const itemsRes = await db.query(rowsQuery, params);
    const countRes = await db.query(countQuery, isAdmin ? [] : [userId]);
    const total = parseInt(countRes.rows[0]?.total || '0', 10);

    res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      items: itemsRes.rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        correlationId: row.correlation_id,
        eventType: row.event_type,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(AppError.badRequest('Invalid audit query parameters', err.errors));
    }
    next(err);
  }
});
