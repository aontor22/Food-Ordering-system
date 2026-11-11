# PostgreSQL production setup

This project now uses PostgreSQL through Prisma. SQLite is no longer the runtime database.

## Local development

Start PostgreSQL:

```bash
docker compose up -d db
```

Set `server/.env`:

```env
DATABASE_URL=postgresql://tomato:tomato@localhost:5432/tomato?schema=public
```

Then run:

```bash
npm install
npm run db:setup
npm run dev
```

`db:setup` generates Prisma Client, applies pending migrations, then runs the idempotent seed.

## Render production

1. Create a Render Postgres database in the same region as the API service.
2. Copy its **Internal Database URL**.
3. Set the Render API service environment variable `DATABASE_URL` to that internal URL.
4. Keep the API Start Command as:

```bash
npm run db:setup -w server && npm start -w server
```

The first deploy creates the schema. Future deploys apply only pending migrations.

## Import an old local SQLite database (optional)

For a data-preserving cutover, do **not** seed the new database before the import. Point `DATABASE_URL` at an empty PostgreSQL database, then run:

```bash
npm run db:generate -w server
npm run db:migrate -w server
SQLITE_DATABASE_PATH=/absolute/path/to/dev.db npm run db:import:sqlite -w server
npm run db:seed -w server
```

The importer refuses a destination that already contains users/products/orders/payments unless `ALLOW_NONEMPTY_SQLITE_IMPORT=true` is explicitly set. This prevents accidentally mixing a seeded PostgreSQL database with legacy production data. It imports parent tables before child tables, preserves the legacy loyalty configuration, and uses unique-key skipping so a retry does not duplicate rows. Back up both databases before a production cutover.

## Tests

Integration tests use an isolated temporary PostgreSQL schema and drop it after the run. Set either `TEST_DATABASE_URL` or `DATABASE_URL` to a reachable PostgreSQL database, then run:

```bash
npm test
```

For local testing, the Docker database URL above is sufficient.
