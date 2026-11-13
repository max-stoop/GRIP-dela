import { NextResponse } from 'next/server';
import { alleenBeheerder, beheerFout } from '@/lib/api/beheer';
import { controleerInvoer } from '@/lib/gebruikers';
import { nodigUit } from '@/lib/auth/uitnodigen';
import { gastenUitnodigen } from '@/lib/platform';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** De uitnodiging van Microsoft opnieuw sturen, bijvoorbeeld als die kwijt is of verlopen. */
export async function POST(req: Request, { params }: Ctx) {
  const b = await alleenBeheerder(req);
  if (!b.ok) return b.antwoord;
  if (!gastenUitnodigen()) return NextResponse.json({ fout: 'GRIP verstuurt hier geen uitnodigingen; de toegang regelt de organisatie' }, { status: 400 });
  const { id } = await params;
  try {
    const email = await b.opslag.emailVan(id);
    if (!email) return NextResponse.json({ fout: 'Gebruiker niet gevonden' }, { status: 404 });
    return NextResponse.json({ uitnodiging: await nodigUit(email) });
  } catch (e) {
    return beheerFout(e, 'Uitnodigen', 'De uitnodiging kon niet worden verstuurd. Probeer het opnieuw.');
  }
}

/** Je eigen rol pas je niet aan, zodat er altijd een beheerder blijft. */
export async function PATCH(req: Request, { params }: Ctx) {
  const b = await alleenBeheerder(req);
  if (!b.ok) return b.antwoord;
  const { id } = await params;
  const c = controleerInvoer(await req.json().catch(() => null), false);
  if (!c.ok) return NextResponse.json({ fout: c.fout }, { status: 400 });
  try {
    const email = await b.opslag.emailVan(id);
    if (!email) return NextResponse.json({ fout: 'Gebruiker niet gevonden' }, { status: 404 });
    if (email.toLowerCase() === b.sessie.email.toLowerCase()) return NextResponse.json({ fout: 'Je eigen rol en regio\'s pas je niet zelf aan' }, { status: 400 });
    return NextResponse.json({ gebruiker: await b.opslag.wijzig(id, c.invoer.rol, c.invoer.regios) });
  } catch (e) {
    return beheerFout(e, 'Gebruiker wijzigen', 'De wijziging kon niet worden bewaard. Probeer het opnieuw.');
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const b = await alleenBeheerder(req);
  if (!b.ok) return b.antwoord;
  const { id } = await params;
  try {
    const email = await b.opslag.emailVan(id);
    if (!email) return NextResponse.json({ fout: 'Gebruiker niet gevonden' }, { status: 404 });
    if (email.toLowerCase() === b.sessie.email.toLowerCase()) return NextResponse.json({ fout: 'Je kunt jezelf niet weghalen' }, { status: 400 });
    await b.opslag.weg(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return beheerFout(e, 'Gebruiker weghalen', 'De gebruiker kon niet worden weggehaald. Probeer het opnieuw.');
  }
}
