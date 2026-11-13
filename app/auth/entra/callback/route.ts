import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { appUrl, LOGIN_COOKIE, rondInloggenAf, SESSIE_COOKIE, SESSIE_DUUR } from '@/lib/auth/entra';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const uit = await rondInloggenAf(new URL(req.url).search, (await cookies()).get(LOGIN_COOKIE)?.value);
  const r = NextResponse.redirect(appUrl(uit ? uit.volgende : '/login?fout=entra'));
  r.cookies.set(LOGIN_COOKIE, '', { path: '/auth/entra', maxAge: 0 });
  if (uit) r.cookies.set(SESSIE_COOKIE, uit.cookie, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSIE_DUUR / 1000 });
  return r;
}
