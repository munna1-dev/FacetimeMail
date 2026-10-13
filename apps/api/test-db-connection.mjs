import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

if (
  !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('REPLACE_WITH_NEW_PASSWORD')
) {
  console.error('DATABASE_URL is missing or still has the placeholder password.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  max: 1,
  ssl: { rejectUnauthorized: true }
});

try {
  const result = await pool.query(
    'SELECT 1 AS connection_ok, current_database() AS database_name'
  );

  console.log('PostgreSQL connection successful.');
  console.log('Database:', result.rows[0].database_name);
  console.log('Read-only connection test passed.');
} catch {
  console.error(
    'Connection failed. Check the password, URL encoding, pooler settings, and SSL.'
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
