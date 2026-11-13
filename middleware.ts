import { NextResponse, type NextRequest } from 'next/server';

const OPEN = ['/login', '/auth', '/api'];

/** www.gripapp.nl naar gripapp.nl: het inloggen en het sessiecookie horen bij één adres. */
function zonderWww(request: NextRequest): URL | null {
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(',')[0].trim().toLowerCase();
  if (!host.startsWith('www.')) return null;
  const { pathname, search } = request.nextUrl;
  return new URL(`https://${host.slice(4)}${pathname}${search}`);
}

export function middleware(request: NextRequest) {
  const doel = zonderWww(request);
  if (doel) return NextResponse.redirect(doel, 308);
  // lokaal: geen inloggen; de server-routes bewaken zichzelf (lib/api/toegang.ts)
  if (process.env.NEXT_PUBLIC_GRIP_PLATFORM !== 'azure') return NextResponse.next();
  // alleen kijken of er een sessie is; de server controleert hem bij elke pagina en aanvraag (lib/sessie.ts)
  if (OPEN.some((p) => request.nextUrl.pathname.startsWith(p)) || request.cookies.has('grip_sessie')) return NextResponse.next();
  return NextResponse.redirect(new URL('/login', request.url));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
