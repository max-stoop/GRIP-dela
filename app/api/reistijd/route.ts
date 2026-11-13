import { NextResponse } from 'next/server';
import { limiet, toegang } from '@/lib/api/toegang';
import { aanbiederUitOmgeving, haalParen, inNederland, type LivePaar } from '@/lib/verdeling/aanbieders';
import { SCHATTING } from '@/lib/verdeling/geo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_PAREN = 1500;

/** Spitsfactor op de Nederlandse kloktijd van vertrek (voor een aanbieder zonder verkeer). */
function spits(vertrek: Date): number {
  const [h, m] = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(vertrek).split(':').map(Number);
  const min = h * 60 + m;
  return SCHATTING.spitsUren.some(([v, t]) => min >= v && min < t) ? SCHATTING.spits : 1;
}

function aanbieder() {
  return aanbiederUitOmgeving(process.env, spits);
}

/** Welke aanbieder er is ingesteld (null = alleen de schatting uit de postcodetabel). */
export async function GET(req: Request) {
  const t = await toegang(req);
  if (!t.ok) return NextResponse.json({ fout: t.fout }, { status: t.status });
  return NextResponse.json({ aanbieder: aanbieder()?.naam ?? null });
}

/** Reistijden in minuten voor paren postcodemiddens: { paren: [{ van: [lat, lng], naar: [lat, lng], vertrek }] }. */
export async function POST(req: Request) {
  const t = await toegang(req);
  if (!t.ok) return NextResponse.json({ fout: t.fout }, { status: t.status });
  const a = aanbieder();
  if (!a) return NextResponse.json({ fout: 'Er is geen reistijdaanbieder ingesteld', aanbieder: null }, { status: 503 });
  // een landelijke verdeling is een paar porties; dit is ruim genoeg om te herhalen, en begrenst de kosten
  const wacht = limiet(`reistijd:${t.sleutel}`, 60, 3_600_000);
  if (wacht) return NextResponse.json({ fout: `Te veel aanvragen; probeer het over ${Math.ceil(wacht / 60)} minuten opnieuw.` }, { status: 429, headers: { 'Retry-After': String(wacht) } });
  let body: { paren?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ fout: 'Ongeldige aanvraag' }, { status: 400 });
  }
  const ruw = Array.isArray(body.paren) ? body.paren : null;
  if (!ruw || !ruw.length || ruw.length > MAX_PAREN) return NextResponse.json({ fout: `Geef 1 tot ${MAX_PAREN} paren` }, { status: 400 });
  const paren: LivePaar[] = [];
  for (const p of ruw as Partial<LivePaar>[]) {
    const van = p?.van, naar = p?.naar;
    const ok = Array.isArray(van) && Array.isArray(naar) && van.length === 2 && naar.length === 2
      && inNederland(van as [number, number]) && inNederland(naar as [number, number])
      && typeof p.vertrek === 'string' && !Number.isNaN(Date.parse(p.vertrek));
    if (!ok) return NextResponse.json({ fout: 'Ongeldig paar: coördinaten in Nederland en een vertrekmoment' }, { status: 400 });
    paren.push({ van: van as [number, number], naar: naar as [number, number], vertrek: p.vertrek! });
  }
  const { minuten, fouten } = await haalParen(a, paren);
  const gelukt = minuten.filter((m) => m != null).length;
  if (!gelukt && fouten.length) return NextResponse.json({ fout: fouten[0], aanbieder: a.naam }, { status: 502 });
  return NextResponse.json({ aanbieder: a.naam, minuten, fouten: fouten.length ? fouten : undefined });
}
