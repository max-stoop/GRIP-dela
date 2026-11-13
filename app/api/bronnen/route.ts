import { NextResponse } from 'next/server';
import { BRONNEN, type BronNaam } from '@/lib/bronnen/common';
import { haalBron } from '@/lib/bronnen/haal';
import { schoolvakanties } from '@/lib/bronnen/schoolvakanties';
import { limiet, toegang } from '@/lib/api/toegang';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Haalt één bron op en geeft compacte reeksen terug: { bron, reeksen, rijen, normaal? }. */
export async function POST(req: Request) {
  const t = await toegang(req);
  if (!t.ok) return NextResponse.json({ fout: t.fout }, { status: t.status });
  // ruim genoeg voor verversen en historie ophalen, maar geen open doorgeefluik naar de bronnen
  const wacht = limiet(`bronnen:${t.sleutel}`, 120, 3_600_000);
  if (wacht) return NextResponse.json({ fout: `Te veel aanvragen; probeer het over ${Math.ceil(wacht / 60)} minuten opnieuw.` }, { status: 429, headers: { 'Retry-After': String(wacht) } });
  let body: { bron?: string; van?: string; tot?: string; schooljaren?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ fout: 'Ongeldige aanvraag' }, { status: 400 });
  }
  if (body.bron === 'schoolvakanties') {
    try {
      const vakanties = await schoolvakanties(String(body.schooljaren ?? '').split(',').filter(Boolean).slice(0, 4));
      return NextResponse.json({ vakanties });
    } catch (e) {
      console.error('Schoolvakanties', e);
      return NextResponse.json({ fout: 'De schoolvakanties konden niet worden opgehaald. Probeer het later opnieuw.' }, { status: 502 });
    }
  }
  const bron = body.bron as BronNaam;
  if (!BRONNEN.includes(bron)) return NextResponse.json({ fout: 'Onbekende bron' }, { status: 400 });
  const archief = bron === 'weer_archief' || bron === 'lucht_archief';
  if (archief && !(ISO.test(body.van ?? '') && ISO.test(body.tot ?? '') && body.van! <= body.tot!)) {
    return NextResponse.json({ fout: 'Geef een geldige periode (van en tot)' }, { status: 400 });
  }
  try {
    const res = await haalBron(bron, { van: body.van, tot: body.tot });
    return NextResponse.json(res);
  } catch (e) {
    console.error(`Bron ${body.bron}`, e);
    return NextResponse.json({ fout: 'Niet bereikbaar' }, { status: 502 });
  }
}
