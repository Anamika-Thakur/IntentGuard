import pg from 'pg';
import { newDb, DataType } from 'pg-mem';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';

const { Pool } = pg;

export interface IDatabaseClient {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<R>>;
  connect(): Promise<pg.PoolClient>;
  end(): Promise<void>;
  isReady(): Promise<boolean>;
}

class PostgresDatabaseClient implements IDatabaseClient {
  private pool: pg.Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    this.pool.on('error', (err) => {
      logger.error('Unexpected idle client error in PostgreSQL pool', { error: err.message });
    });
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  async connect(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as alive');
      return res.rowCount === 1;
    } catch {
      return false;
    }
  }
}

class InMemoryDatabaseClient implements IDatabaseClient {
  private pool: pg.Pool;

  constructor() {
    logger.info('Initializing hermetic in-memory PostgreSQL instance (pg-mem)');
    const db = newDb({
      autoCreateForeignKeyIndices: true,
    });

    // Register uuid generator
    db.public.registerFunction({
      name: 'gen_random_uuid',
      returns: DataType.text,
      implementation: () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'mock-uuid'),
    });

    const adapter = db.adapters.createPg();
    this.pool = new adapter.Pool();
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, params);
  }

  async connect(): Promise<pg.PoolClient> {
    return this.pool.connect();
  }

  async end(): Promise<void> {
    await this.pool.end();
  }

  async isReady(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as alive');
      return (res.rowCount ?? 0) >= 1;
    } catch {
      return false;
    }
  }
}

let dbInstance: IDatabaseClient | null = null;

export function getDbClient(): IDatabaseClient {
  if (!dbInstance) {
    const shouldRunInMemory =
      config.NODE_ENV === 'test' ||
      config.USE_IN_MEMORY_DB ||
      !config.DATABASE_URL ||
      config.DATABASE_URL.includes('localhost:5432');

    if (shouldRunInMemory) {
      dbInstance = new InMemoryDatabaseClient();
    } else {
      dbInstance = new PostgresDatabaseClient(config.DATABASE_URL);
    }
  }
  return dbInstance;
}

export function resetDbClientForTesting(client?: IDatabaseClient): void {
  dbInstance = client ?? new InMemoryDatabaseClient();
}
