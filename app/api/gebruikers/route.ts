import { NextResponse } from 'next/server';
import { alleenBeheerder, beheerFout } from '@/lib/api/beheer';
import { controleerInvoer } from '@/lib/gebruikers';
import { nodigUit } from '@/lib/auth/uitnodigen';
import { gastenUitnodigen } from '@/lib/platform';

export const dynamic = 'force-dynamic';

export async function GET() {
  const b = await alleenBeheerder();
  if (!b.ok) return b.antwoord;
  try {
    return NextResponse.json({ gebruikers: await b.opslag.lijst() });
  } catch (e) {
    return beheerFout(e, 'Gebruikers ophalen', 'De gebruikers konden niet worden opgehaald. Probeer het later opnieuw.');
  }
}

export async function POST(req: Request) {
  const b = await alleenBeheerder(req);
  if (!b.ok) return b.antwoord;
  const c = controleerInvoer(await req.json().catch(() => null));
  if (!c.ok) return NextResponse.json({ fout: c.fout }, { status: 400 });
  try {
    if (await b.opslag.bestaat(c.invoer.email)) return NextResponse.json({ fout: 'Er is al een gebruiker met dit e-mailadres' }, { status: 409 });
    const gebruiker = await b.opslag.maak(c.invoer);
    // de gebruiker staat er al; mislukt de uitnodiging, dan zegt het antwoord dat
    const uitnodiging = gastenUitnodigen() ? await nodigUit(c.invoer.email) : null;
    return NextResponse.json({ gebruiker, uitnodiging }, { status: 201 });
  } catch (e) {
    return beheerFout(e, 'Gebruiker bewaren', 'De gebruiker kon niet worden bewaard. Probeer het opnieuw.');
  }
}
