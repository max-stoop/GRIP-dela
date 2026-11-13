import { NextResponse } from 'next/server';
import { gedeeld } from '@/lib/platform';
import { database } from '@/lib/server/postgres';

export const dynamic = 'force-dynamic';

/**
 * Gezondheidscheck voor App Service en de monitoring: 200 als de app draait en de database antwoordt, anders 503.
 * Zegt niets over gegevens; zonder inloggen te gebruiken.
 */
export async function GET() {
  if (!gedeeld()) return NextResponse.json({ gezond: true, database: 'lokaal' });
  try {
    const p = await database();
    await p.query('select 1');
    return NextResponse.json({ gezond: true, database: 'ok' });
  } catch (e) {
    console.error('Gezondheidscheck', e);
    return NextResponse.json({ gezond: false, database: 'onbereikbaar' }, { status: 503 });
  }
}
