import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './logger/index.js';
import { runMigrations } from './db/migrate.js';
import { getDbClient } from './db/client.js';

async function bootstrap() {
  logger.info('Initializing IntentGuard Backend Server...', {
    env: config.NODE_ENV,
    port: config.PORT,
    host: config.HOST,
    paypalEnv: config.PAYPAL_ENV,
  });

  // Run database migrations on startup
  try {
    await runMigrations();
  } catch (err) {
    logger.error('Startup migration failure:', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(`IntentGuard server listening at http://${config.HOST}:${config.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      try {
        const db = getDbClient();
        await db.end();
        logger.info('Database pool closed. Shutdown complete.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during graceful shutdown:', { error: String(err) });
        process.exit(1);
      }
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrapping error:', { error: String(err) });
  process.exit(1);
});
