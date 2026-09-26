import 'dotenv/config';

const url = process.env.DATABASE_URL || '';
if (!/^postgres(?:ql)?:\/\//i.test(url)) {
  throw new Error('This project now uses PostgreSQL. Set DATABASE_URL to a PostgreSQL URL and run `npm run db:setup`.');
}

console.log('PostgreSQL is managed by Prisma Migrate. Run `npm run db:setup` (or `npm run db:migrate`) instead of the legacy SQLite initializer.');
