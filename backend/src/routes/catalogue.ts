import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDbClient } from '../db/client.js';
import { AppError } from '../errors/index.js';
import { v4 as uuidv4 } from 'uuid';

export const catalogueRouter = Router();
const db = getDbClient();

/**
 * GET /api/catalogue/products
 * Returns authoritative server-side merchant catalogue.
 */
catalogueRouter.get('/products', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const productsRes = await db.query(`
      SELECT p.id, p.merchant_id, p.sku, p.title, p.unit_price_cents, p.currency, p.active, m.name as merchant_name
      FROM catalogue_products p
      JOIN merchants m ON p.merchant_id = m.merchant_id
      ORDER BY p.created_at ASC
    `);

    res.status(200).json({
      items: productsRes.rows.map((row) => ({
        id: row.id,
        merchantId: row.merchant_id,
        merchantName: row.merchant_name,
        sku: row.sku,
        title: row.title,
        unitPriceCents: row.unit_price_cents,
        priceFormatted: `$${(row.unit_price_cents / 100).toFixed(2)} ${row.currency}`,
        currency: row.currency,
        active: row.active,
      })),
    });
  } catch (err) {
    next(err);
  }
});

const createProductSchema = z.object({
  merchantId: z.string().min(1),
  merchantName: z.string().min(1).optional(),
  sku: z.string().min(1),
  title: z.string().min(1),
  unitPriceCents: z.number().int().positive(),
  currency: z.string().length(3).default('USD'),
});

/**
 * POST /api/catalogue/products
 * Allows merchants/sellers to list a new product in the PayPal developer sandbox marketplace.
 */
catalogueRouter.post('/products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createProductSchema.parse(req.body);

    // Ensure merchant exists or register merchant
    await db.query(
      `INSERT INTO merchants (id, merchant_id, name, verified)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (merchant_id) DO UPDATE SET name = EXCLUDED.name`,
      [`mer_${uuidv4().replace(/-/g, '').substring(0, 8)}`, body.merchantId, body.merchantName || body.merchantId]
    );

    const productId = `prod_${uuidv4().replace(/-/g, '').substring(0, 10)}`;
    const result = await db.query(
      `INSERT INTO catalogue_products (id, merchant_id, sku, title, unit_price_cents, currency, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (merchant_id, sku) DO UPDATE 
       SET title = EXCLUDED.title, unit_price_cents = EXCLUDED.unit_price_cents
       RETURNING *`,
      [productId, body.merchantId, body.sku, body.title, body.unitPriceCents, body.currency.toUpperCase()]
    );

    const item = result.rows[0];
    if (!item) {
      throw AppError.internal('Failed creating catalogue product.');
    }

    res.status(201).json({
      id: item.id,
      merchantId: item.merchant_id,
      sku: item.sku,
      title: item.title,
      unitPriceCents: item.unit_price_cents,
      priceFormatted: `$${(item.unit_price_cents / 100).toFixed(2)} ${item.currency}`,
      currency: item.currency,
      active: item.active,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return next(AppError.badRequest('Invalid product listing format', err.errors));
    }
    next(err);
  }
});
