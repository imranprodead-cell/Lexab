/** CLI: apply pending migrations (`npm run migrate`). */
import { getDb, migrate } from './db.ts';

const db = await getDb();
const ran = await migrate(db);
console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Already up to date');
await db.close();
