import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/versie/route';

describe('/api/versie', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('geeft de commit en de omgeving: daarop wacht de uitrol, en productie neemt die van test', async () => {
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
    vi.stubEnv('GRIP_VERSIE', 'a'.repeat(40));
    vi.stubEnv('GRIP_OMGEVING', 'test');
    expect(await GET().json()).toEqual({ versie: 'a'.repeat(40), omgeving: 'test' });
  });

  it('zonder GRIP_OMGEVING is het in Azure productie, en lokaal lokaal', async () => {
    vi.stubEnv('GRIP_OMGEVING', '');
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', 'azure');
    expect((await GET().json()).omgeving).toBe('productie');
    vi.stubEnv('NEXT_PUBLIC_GRIP_PLATFORM', '');
    expect((await GET().json()).omgeving).toBe('lokaal');
  });
});
