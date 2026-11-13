import { describe, it, expect } from 'vitest';
import { regiosVan, vindProfiel, type Profiel, type ProfielBron } from '@/lib/sessie';
import { WERKREGIOS } from '@/lib/nbd/parameters';
import { veiligeVolgende } from '@/lib/auth/volgende';

/** Een tabel users in het geheugen, met dezelfde regels als de bron in de database. */
function bron(rijen: (Profiel & { auth_id: string | null })[]): ProfielBron & { rijen: typeof rijen } {
  return {
    rijen,
    opAuthId: async (id) => rijen.find((r) => r.auth_id === id) ?? null,
    vrijOpEmail: async (email) => rijen.filter((r) => r.auth_id == null && r.email.toLowerCase() === email.toLowerCase()),
    koppel: async (id, authId) => {
      const r = rijen.find((x) => x.id === id && x.auth_id == null);
      if (!r) return false;
      r.auth_id = authId;
      return true;
    },
  };
}

const planner = (id: string, email: string, auth_id: string | null = null) => ({ id, naam: 'J. Kee', email, rol: 'Planner', regios: null, auth_id });
const bevestigd = '2026-10-01T10:00:00Z';

describe('inloggen: account en profiel', () => {
  it('een gekoppeld account vindt zijn eigen profiel', async () => {
    const b = bron([planner('u1', 'jkee@voorbeeld.nl', 'a1')]);
    expect((await vindProfiel(b, { id: 'a1', email: 'iemand@anders.nl' }))?.id).toBe('u1');
  });

  it('bij de eerste keer inloggen koppelt het account op e-mailadres, ongeacht hoofdletters', async () => {
    const b = bron([planner('u1', 'Jkee@voorbeeld.nl')]);
    expect((await vindProfiel(b, { id: 'a1', email: 'jkee@voorbeeld.nl', email_confirmed_at: bevestigd }))?.id).toBe('u1');
    expect(b.rijen[0].auth_id).toBe('a1');
  });

  it('geen toegang zonder profiel, met een onbevestigd adres, of bij twee profielen met hetzelfde adres', async () => {
    expect(await vindProfiel(bron([]), { id: 'a1', email: 'vreemd@gmail.com', email_confirmed_at: bevestigd })).toBeNull();
    const b = bron([planner('u1', 'jkee@voorbeeld.nl')]);
    expect(await vindProfiel(b, { id: 'a1', email: 'jkee@voorbeeld.nl', email_confirmed_at: null })).toBeNull();
    expect(b.rijen[0].auth_id).toBeNull();
    expect(await vindProfiel(bron([planner('u1', 'jkee@voorbeeld.nl'), planner('u2', 'JKEE@voorbeeld.nl')]), { id: 'a1', email: 'jkee@voorbeeld.nl', email_confirmed_at: bevestigd })).toBeNull();
  });

  it('een profiel dat al aan een ander account hangt, wordt niet overgenomen', async () => {
    const b = bron([planner('u1', 'jkee@voorbeeld.nl', 'a-echt')]);
    expect(await vindProfiel(b, { id: 'a-nep', email: 'jkee@voorbeeld.nl', email_confirmed_at: bevestigd })).toBeNull();
    expect(b.rijen[0].auth_id).toBe('a-echt');
  });
});

describe('terug na het inloggen', () => {
  it('alleen naar een pad op deze site', () => {
    expect(veiligeVolgende('/rooster')).toBe('/rooster');
    expect(veiligeVolgende(null, '/rooster')).toBe('/rooster');
    for (const kwaad of ['https://evil.nl', '//evil.nl', '/\\evil.nl', 'javascript:alert(1)']) expect(veiligeVolgende(kwaad)).toBe('/');
  });
});

describe('regio\'s van wie is ingelogd', () => {
  it('een regiomanager zonder regio\'s (of met onbekende) heeft er geen, niet alle', () => {
    expect(regiosVan('regiomanager', { regios: [] }, [])).toEqual([]);
    expect(regiosVan('regiomanager', { regios: null }, [])).toEqual([]);
    expect(regiosVan('regiomanager', { regios: [99] }, [])).toEqual([]);
    expect(regiosVan('regiomanager', { regios: [1] }, ['Utrecht'])).toEqual(['Utrecht']);
    // alle werkregio's expliciet gekozen: alle
    expect(regiosVan('regiomanager', { regios: WERKREGIOS.map((_, i) => i + 1) }, WERKREGIOS)).toBeNull();
  });

  it('een planner en de beheerder hebben altijd alle; een medewerker zonder regio\'s houdt het scherm open (de database kiest de eigen regel)', () => {
    expect(regiosVan('planner', { regios: [1] }, ['Utrecht'])).toBeNull();
    expect(regiosVan('beheerder', { regios: [] }, [])).toBeNull();
    expect(regiosVan('medewerker', { regios: [] }, [])).toBeNull();
    expect(regiosVan('medewerker', { regios: [1] }, ['Utrecht'])).toEqual(['Utrecht']);
  });
});
