import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const connectionString = this.configService.get<string>('database.connectionString');
    const ssl = this.configService.get('database.ssl');

    if (connectionString) {
      // Railway / cloud: single DATABASE_URL with SSL
      this.pool = new Pool({
        connectionString,
        max: this.configService.get<number>('database.max'),
        ssl: ssl || undefined,
      });
      this.logger.log('Using DATABASE_URL connection string');
    } else {
      // Docker Compose / local: individual env vars
      this.pool = new Pool({
        host: this.configService.get<string>('database.host'),
        port: this.configService.get<number>('database.port'),
        user: this.configService.get<string>('database.user'),
        password: this.configService.get<string>('database.password'),
        database: this.configService.get<string>('database.database'),
        max: this.configService.get<number>('database.max'),
      });
    }

    // Verify connection, run migrations, and ensure partitions
    try {
      const client = await this.pool.connect();
      this.logger.log('Database connection established successfully');
      client.release();
      await this.runMigrations();
      await this.ensurePartitions();
    } catch (error) {
      this.logger.error('Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.logger.log('Database pool closed');
    }
  }

  async query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    const result = await this.pool.query<T>(text, params);
    const duration = Date.now() - start;

    this.logger.debug(
      `Query executed in ${duration}ms | rows: ${result.rowCount}`,
    );

    return result;
  }

  async getClient(): Promise<PoolClient> {
    return this.pool.connect();
  }

  /**
   * Execute multiple queries within a single transaction
   */
  async transaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Run init.sql migration on startup.
   * All statements are idempotent (IF NOT EXISTS, ON CONFLICT DO NOTHING),
   * so this is safe to run on every boot -- no duplicate data, no errors.
   * In Docker Compose, init.sql is also mounted via entrypoint, so this
   * is a no-op (tables already exist). On Railway/cloud, this is the
   * primary schema bootstrapper.
   */
  private async runMigrations(): Promise<void> {
    // Try multiple possible locations for init.sql
    const possiblePaths = [
      join(__dirname, 'migrations', 'init.sql'),           // dist/database/migrations/init.sql
      join(process.cwd(), 'dist', 'database', 'migrations', 'init.sql'),
      join(process.cwd(), 'src', 'database', 'migrations', 'init.sql'),
    ];

    let sqlPath: string | null = null;
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        sqlPath = p;
        break;
      }
    }

    if (!sqlPath) {
      this.logger.warn('init.sql not found -- skipping schema migration');
      return;
    }

    const sql = readFileSync(sqlPath, 'utf-8');
    await this.pool.query(sql);
    this.logger.log('Schema migration (init.sql) executed successfully');
  }

  /**
   * Ensure daily partitions exist for today and tomorrow.
   * Called at startup and can be called on-demand (e.g. by a cron job at midnight).
   * Uses the ensure_daily_partition() SQL function which is idempotent.
   */
  async ensurePartitions(): Promise<void> {
    const tables = ['meter_telemetry', 'vehicle_telemetry'];
    const dates = ['CURRENT_DATE', 'CURRENT_DATE + 1'];

    for (const table of tables) {
      for (const date of dates) {
        await this.pool.query(
          `SELECT ensure_daily_partition($1, ${date})`,
          [table],
        );
      }
    }

    this.logger.log('Daily partitions ensured for today and tomorrow');
  }

  /**
   * Ensure a partition exists for a specific date on a given table.
   * Called before cold-path inserts so any timestamp is accepted.
   * The SQL function is idempotent -- safe to call repeatedly.
   */
  async ensurePartitionForDate(table: string, date: Date): Promise<void> {
    await this.pool.query(
      `SELECT ensure_daily_partition($1, $2::date)`,
      [table, date.toISOString().slice(0, 10)],
    );
  }

  /**
   * Check if the database connection is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
