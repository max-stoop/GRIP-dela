import { NextResponse } from 'next/server';
import { dagtaakOpServer } from '@/lib/taken/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Aangeroepen met de geheime sleutel CRON_SECRET in de header; zonder die sleutel gebeurt er niets. */
export async function GET(req: Request) {
  const geheim = process.env.CRON_SECRET;
  if (!geheim) return NextResponse.json({ fout: 'Niet ingesteld' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${geheim}`) return NextResponse.json({ fout: 'Geen toegang' }, { status: 401 });
  const uitkomst = await dagtaakOpServer();
  if (!uitkomst) return NextResponse.json({ fout: 'Niet ingesteld' }, { status: 503 });
  return NextResponse.json(uitkomst, { status: uitkomst.status === 'mislukt' ? 500 : 200 });
}
