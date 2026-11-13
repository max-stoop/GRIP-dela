/** De dagelijkse taak op de server: met de database als de server zelf (zonder ingelogde gebruiker). */
import { gedeeld } from '@/lib/platform';
import { vraagDb } from '@/lib/store/db/vraag';
import { alsServer, database } from '@/lib/server/postgres';
import { beantwoord } from '@/lib/server/sql';
import { haalBron } from '@/lib/bronnen/haal';
import { voerDagtaakUit } from '@/lib/taken/dagelijks';
import { nowStamp, todayIso } from '@/lib/dates';
import type { Db } from '@/lib/store/db/db';

async function serverDb(): Promise<Db | null> {
  if (!gedeeld()) return null;
  const p = await database();
  return vraagDb((v) => alsServer(p, (voer) => beantwoord(v, voer)));
}

/** Null als er geen gedeelde database is. */
export async function dagtaakOpServer() {
  const db = await serverDb();
  if (!db) return null;
  return voerDagtaakUit(db, { vandaag: todayIso(), nu: () => nowStamp(), haal: (b) => haalBron(b) });
}
