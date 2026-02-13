import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  // Railway provides DATABASE_URL; Docker Compose uses individual vars
  connectionString: process.env.DATABASE_URL || undefined,
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'zynetic',
  password: process.env.POSTGRES_PASSWORD || 'zynetic_secret',
  database: process.env.POSTGRES_DB || 'zynetic_energy',
  max: parseInt(process.env.PG_POOL_MAX || '20', 10),
  // Enable SSL for cloud providers (Railway, etc.)
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
}));
