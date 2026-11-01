import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDbClient, IDatabaseClient } from './client.js';
import { logger } from '../logger/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(customClient?: IDatabaseClient): Promise<void> {
  const db = customClient || getDbClient();
  logger.info('Applying database migrations...');

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    logger.info(`Running migration: ${file}`);
    await db.query(sql);
  }

  // Seed default test user, merchant and verified catalogue
  await seedInitialData(db);
  logger.info('Database migrations applied successfully.');
}

export async function seedInitialData(db: IDatabaseClient): Promise<void> {
  // Test users
  await db.query(`
    INSERT INTO users (id, email, role)
    VALUES 
      ('usr_test_123', 'alice@example.com', 'user'),
      ('usr_test_456', 'bob@example.com', 'user'),
      ('usr_admin_999', 'admin@intentguard.security', 'admin')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Verified merchants
  await db.query(`
    INSERT INTO merchants (id, merchant_id, name, verified)
    VALUES 
      ('mer_acme_01', 'MERCHANT_ACME_STORE', 'Acme Store Official', true),
      ('mer_tech_02', 'MERCHANT_TECH_SUPPLY', 'Tech Supplies Inc.', true)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Authoritative catalogue products (minor units in cents: $15.50 -> 1550 cents)
  await db.query(`
    INSERT INTO catalogue_products (id, merchant_id, sku, title, unit_price_cents, currency, active)
    VALUES 
      ('prod_acme_widget', 'MERCHANT_ACME_STORE', 'SKU-WIDGET-01', 'Official Precision Widget', 2500, 'USD', true),
      ('prod_acme_gadget', 'MERCHANT_ACME_STORE', 'SKU-GADGET-99', 'Acme Hyper Gadget', 4900, 'USD', true),
      ('prod_tech_cable', 'MERCHANT_TECH_SUPPLY', 'SKU-USB-C-2M', 'High Speed USB-C Cable', 1200, 'USD', true)
    ON CONFLICT (id) DO NOTHING;
  `);
}

// Direct CLI execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      logger.info('Migration runner completed.');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration failed:', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}
