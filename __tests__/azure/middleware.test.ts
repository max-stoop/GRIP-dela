// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const vraag = (pad: string, headers: Record<string, string>, cookie?: string) =>
  new NextRequest(`http://0.0.0.0:8080${pad}`, { headers: { ...headers, ...(cookie ? { cookie } : {}) } });

afterEach(() => vi.unstubAllEnvs());

describe('middleware', () => {
  it('stuurt www door naar het adres zonder www, met pad en zoekvraag', () => {
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
    const r = middleware(vraag('/rooster?maand=2026-11', { host: 'www.gripapp.nl' }));
    expect(r.status).toBe(308);
    expect(r.headers.get('location')).toBe('https://gripapp.nl/rooster?maand=2026-11');
    const achterProxy = middleware(vraag('/', { host: 'grip-abc.azurewebsites.net', 'x-forwarded-host': 'WWW.gripapp.nl' }));
    expect(achterProxy.headers.get('location')).toBe('https://gripapp.nl/');
  });

  it('laat het eigen adres en test met rust, en stuurt zonder sessie naar het inloggen', () => {
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
    expect(middleware(vraag('/rooster', { host: 'gripapp.nl' }, 'grip_sessie=x')).headers.get('location')).toBeNull();
    expect(middleware(vraag('/login', { host: 'test.gripapp.nl' })).headers.get('location')).toBeNull();
    expect(middleware(vraag('/rooster', { host: 'gripapp.nl' })).headers.get('location')).toMatch(/\/login$/);
  });
});
