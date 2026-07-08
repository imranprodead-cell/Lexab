/** CLI: migrate then seed if the database is empty (`npm run seed`). */
import { getDb, migrate } from './db.ts';
import { seedIfEmpty } from './seed-data.ts';

const db = await getDb();
await migrate(db);
const seeded = await seedIfEmpty(db);
console.log(
  seeded
    ? 'Seeded demo data. Demo login: a.rahman@freshfields.com (password: SEED_DEMO_PASSWORD, default "lexai-demo").'
    : 'Database already has users — nothing to do. To re-seed, point at a fresh database (or delete DATA_DIR/pg for PGlite).',
);
await db.close();
