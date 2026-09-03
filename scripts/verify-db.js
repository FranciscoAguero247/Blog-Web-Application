import PG from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const db = new PG.Client({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'blog_web_app',
  password: process.env.DB_PASSWORD || 'postgres',
  port: Number(process.env.DB_PORT || 5432),
});

async function verify() {
  try {
    await db.connect();
    const result = await db.query('SELECT 1');
    console.log('Database connection verified:', result.rows[0]);
  } catch (error) {
    console.error('Database verification failed:', error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

verify();
