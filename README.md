An Express and EJS community app with PostgreSQL persistence.

## Environment

The app supports two database modes:

- Local Postgres with `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`
- Hosted Postgres with `DATABASE_URL` (recommended for Vercel and Supabase)

Optional Supabase session refresh support is enabled when both values below exist:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

If Supabase is slow or unavailable, the middleware fails open so core routes still load.
