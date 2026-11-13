/** Alleen de beheerder, en alleen met een gedeelde database (gebruikersbeheer). */
import { NextResponse } from 'next/server';
import { gedeeld } from '@/lib/platform';
import { bepaalSessie, type Sessie } from '@/lib/sessie';
import { GebruikerFout, gebruikersopslag, type Gebruikersopslag } from '@/lib/server/gebruikers';
import { vanDezeSite } from './herkomst';

type Beheer = { ok: true; sessie: Sessie; opslag: Gebruikersopslag } | { ok: false; antwoord: NextResponse };

const fout = (status: number, tekst: string): Beheer => ({ ok: false, antwoord: NextResponse.json({ fout: tekst }, { status }) });

export async function alleenBeheerder(req?: Request): Promise<Beheer> {
  if (req && !vanDezeSite(req)) return fout(403, 'Niet toegestaan');
  if (!gedeeld()) return fout(404, 'Gebruikersbeheer is in deze omgeving niet beschikbaar');
  const u = await bepaalSessie();
  if (u.soort === 'niet_ingelogd') return fout(401, 'Niet ingelogd');
  if (u.soort === 'geen_profiel' || u.sessie.rol !== 'beheerder') return fout(403, 'Alleen voor de beheerder');
  return { ok: true, sessie: u.sessie, opslag: gebruikersopslag() };
}

/** Een verwachte fout met zijn eigen melding; de rest in het logboek van de server en een algemene melding. */
export function beheerFout(e: unknown, wat: string, tekst: string): NextResponse {
  if (e instanceof GebruikerFout) return NextResponse.json({ fout: e.message }, { status: e.status });
  console.error(wat, e);
  return NextResponse.json({ fout: tekst }, { status: 500 });
}
