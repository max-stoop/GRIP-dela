import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { leesWerkaccount, SESSIE_COOKIE } from '@/lib/auth/entra';
import { vanDezeSite } from '@/lib/api/herkomst';
import { platform } from '@/lib/platform';
import { alsGebruiker, database } from '@/lib/server/postgres';
import { beantwoord, leesVraag, OngeldigeVraag } from '@/lib/server/sql';

export const dynamic = 'force-dynamic';

/** Alles wat de app leest en bewaart, met de rechten van wie is ingelogd (RLS). */
export async function POST(req: Request) {
  if (platform() !== 'azure') return NextResponse.json({ fout: 'Niet beschikbaar' }, { status: 404 });
  if (!vanDezeSite(req)) return NextResponse.json({ fout: 'Niet toegestaan' }, { status: 403 });
  const w = await leesWerkaccount((await cookies()).get(SESSIE_COOKIE)?.value);
  if (!w) return NextResponse.json({ fout: 'Niet ingelogd' }, { status: 401 });
  try {
    const v = leesVraag(await req.json());
    return NextResponse.json({ uit: await alsGebruiker(await database(), w.oid, (voer) => beantwoord(v, voer)) });
  } catch (e) {
    if (e instanceof OngeldigeVraag || e instanceof SyntaxError) return NextResponse.json({ fout: e.message }, { status: 400 });
    // een melding van Postgres zelf (rechten, conflict) gaat mee: de app leest daar de oorzaak uit
    if (/^[0-9A-Z]{5}$/.test(String((e as { code?: unknown }).code))) return NextResponse.json({ fout: (e as Error).message }, { status: 409 });
    if (req.signal.aborted) return new Response(null, { status: 499 });
    console.error('Database', e);
    return NextResponse.json({ fout: 'De database is even niet bereikbaar. Probeer het zo opnieuw.' }, { status: 503 });
  }
}
