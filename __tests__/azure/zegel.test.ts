import { describe, expect, it } from 'vitest';
import { ontzegel, verzegel } from '@/lib/auth/zegel';

const GEHEIM = 'een-geheim-van-minstens-tweeendertig-tekens';

describe('het verzegelde cookie', () => {
  it('opent alleen met hetzelfde geheim, ongeschonden en op tijd', async () => {
    const z = await verzegel({ oid: 'a' }, Date.now() + 60_000, GEHEIM);
    expect(await ontzegel(z, GEHEIM)).toMatchObject({ oid: 'a' });
    expect(await ontzegel(z, `${GEHEIM}x`)).toBeNull();
    expect(await ontzegel(`${z.slice(0, -2)}AA`, GEHEIM)).toBeNull();
    expect(await ontzegel(z, GEHEIM, Date.now() + 120_000)).toBeNull();
    expect(await ontzegel(undefined, GEHEIM)).toBeNull();
    expect(await ontzegel('rommel', GEHEIM)).toBeNull();
  });

  it('elke keer anders versleuteld, en de inhoud is niet leesbaar', async () => {
    const a = await verzegel({ email: 'jan@voorbeeld.nl' }, Date.now() + 60_000, GEHEIM);
    const b = await verzegel({ email: 'jan@voorbeeld.nl' }, Date.now() + 60_000, GEHEIM);
    expect(a).not.toBe(b);
    expect(Buffer.from(a.split('.')[1], 'base64url').toString()).not.toContain('jan');
  });

  it('een te kort geheim wordt geweigerd', async () => {
    await expect(verzegel({}, Date.now() + 1000, 'kort')).rejects.toThrow(/te kort/);
  });
});
