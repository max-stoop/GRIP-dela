import { NextResponse } from 'next/server';
import { SESSIE_COOKIE } from '@/lib/auth/entra';
import { vanDezeSite } from '@/lib/api/herkomst';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!vanDezeSite(req)) return NextResponse.json({ fout: 'Niet toegestaan' }, { status: 403 });
  const r = NextResponse.json({ ok: true });
  r.cookies.set(SESSIE_COOKIE, '', { path: '/', maxAge: 0 });
  return r;
}
