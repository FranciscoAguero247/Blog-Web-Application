import PG from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const db = new PG.Client({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'blog_web_app',
  password: process.env.DB_PASSWORD || 'postgres',
  port: Number(process.env.DB_PORT || 5432),
});

async function init() {
  try {
    await db.connect();

    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(80) NOT NULL UNIQUE,
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        slug VARCHAR(100) NOT NULL UNIQUE,
        description TEXT,
        created_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        group_id INTEGER,
        group_name VARCHAR(100),
        category VARCHAR(50),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        post_id INTEGER,
        user_id INTEGER,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS memberships (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        group_id INTEGER,
        UNIQUE (user_id, group_id),
        joined_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS content_reports (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        reporter_id INTEGER NOT NULL,
        post_id INTEGER,
        comment_id INTEGER,
        reason VARCHAR(120) NOT NULL,
        details TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        reviewed_by INTEGER,
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        CONSTRAINT report_target_check CHECK (
          (CASE WHEN post_id IS NULL THEN 0 ELSE 1 END) +
          (CASE WHEN comment_id IS NULL THEN 0 ELSE 1 END) = 1
        )
      );

      ALTER TABLE posts ADD COLUMN IF NOT EXISTS user_id INTEGER;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_id INTEGER;
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS group_name VARCHAR(100);
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(50);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS memberships_user_group_idx ON memberships(user_id, group_id);
      CREATE INDEX IF NOT EXISTS posts_group_id_idx ON posts(group_id);
      CREATE INDEX IF NOT EXISTS posts_created_at_idx ON posts(created_at DESC);
      CREATE INDEX IF NOT EXISTS comments_post_id_idx ON comments(post_id);
      CREATE INDEX IF NOT EXISTS content_reports_group_status_idx ON content_reports(group_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS content_reports_post_idx ON content_reports(post_id);
      CREATE INDEX IF NOT EXISTS content_reports_comment_idx ON content_reports(comment_id);
    `);

    console.log('Database initialized successfully.');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  } finally {
    await db.end();
  }
}

init();
