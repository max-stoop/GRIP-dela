import { describe, expect, it } from 'vitest';
import { noteer, Versies, type Leesronde } from '@/lib/store/db/versies';

const ronde = (f: (r: Leesronde) => void) => {
  const r: Leesronde = new Map();
  f(r);
  return r;
};

describe('versies bijhouden', () => {
  it('een gefilterde leesronde houdt wat een ander onderdeel van dezelfde tabel las', () => {
    const v = new Versies();
    v.vervang(ronde((r) => noteer(r, 'rp_rooster', [{ kolom: 'datum', op: 'gte', waarde: '2026-10-01' }], [{ medewerker_id: 'm1', datum: '2026-10-02', rij_versie: 3 }])));
    v.vervang(ronde((r) => noteer(r, 'rp_rooster', [{ kolom: 'datum', op: 'gte', waarde: '2026-11-01' }], [{ medewerker_id: 'm1', datum: '2026-11-02', rij_versie: 5 }])));
    expect(v.controle('rp_rooster', { medewerker_id: 'm1', datum: '2026-10-02' }, false)).toBe(3);
    expect(v.controle('rp_rooster', { medewerker_id: 'm1', datum: '2026-11-02' }, false)).toBe(5);
    // nieuw binnen een gelezen venster: mag nog niet bestaan; daarbuiten (niet ingeladen): geen controle
    expect(v.controle('rp_rooster', { medewerker_id: 'm2', datum: '2026-10-05' }, true)).toBe(0);
    expect(v.controle('rp_rooster', { medewerker_id: 'm2', datum: '2025-10-05' }, true)).toBeUndefined();
  });

  it('de hele tabel opnieuw gelezen vervangt wat er bekend was', () => {
    const v = new Versies();
    v.vervang(ronde((r) => noteer(r, 'rp_wens', [], [{ id: 'a', rij_versie: 2 }, { id: 'b', rij_versie: 1 }])));
    v.vervang(ronde((r) => noteer(r, 'rp_wens', [], [{ id: 'a', rij_versie: 4 }])));
    expect(v.controle('rp_wens', { id: 'a' }, false)).toBe(4);
    expect(v.controle('rp_wens', { id: 'b' }, false)).toBeUndefined();
  });

  it('na het schrijven: nieuwe versies erbij, weggehaalde rijen eruit', () => {
    const v = new Versies();
    v.vervang(ronde((r) => noteer(r, 'rp_wens', [], [{ id: 'a', rij_versie: 2 }, { id: 'b', rij_versie: 1 }])));
    v.naSchrijven([{ t: 'rp_wens', k: ['a'], v: 3 }], [{ tabel: 'rp_wens', soort: 'delete', sleutels: [{ id: 'b' }] }]);
    expect(v.controle('rp_wens', { id: 'a' }, false)).toBe(3);
    expect(v.controle('rp_wens', { id: 'b' }, false)).toBeUndefined();
  });
});
