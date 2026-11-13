import { NextResponse } from 'next/server';
import { appUrl, LOGIN_COOKIE, naarEigenAdres, startInloggen } from '@/lib/auth/entra';
import { veiligeVolgende } from '@/lib/auth/volgende';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const volgende = veiligeVolgende(new URL(req.url).searchParams.get('volgende'));
  try {
    const elders = naarEigenAdres(req);
    if (elders) return NextResponse.redirect(elders);
    const { naar, cookie } = await startInloggen(volgende);
    const r = NextResponse.redirect(naar);
    r.cookies.set(LOGIN_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/entra', maxAge: 600 });
    return r;
  } catch (e) {
    console.error('Inloggen starten', e);
    // achter de proxy van Azure is req.url het interne adres
    let terug: URL;
    try { terug = appUrl('/login?fout=entra'); } catch { terug = new URL('/login?fout=entra', req.url); }
    return NextResponse.redirect(terug);
  }
}
