/** CLI: migrate then seed if the database is empty (`npm run seed`). */
import { getDb, migrate } from './db.ts';
import { seedIfEmpty } from './seed-data.ts';

const db = await getDb();
await migrate(db);
// seedIfEmpty сам требует SEED_DEMO_DATA=true и непустой SEED_DEMO_PASSWORD —
// понятная ошибка вместо тихого создания демо-аккаунта с планом Pro.
const seeded = await seedIfEmpty(db).catch(async (err: unknown) => {
  console.error(String(err instanceof Error ? err.message : err));
  await db.close();
  process.exit(1);
});
console.log(
  seeded
    ? 'Seeded demo data. Demo login: a.rahman@freshfields.com (пароль — значение SEED_DEMO_PASSWORD).'
    : 'Database already has users — nothing to do. To re-seed, point at a fresh database (or delete DATA_DIR/pg for PGlite).',
);
await db.close();
