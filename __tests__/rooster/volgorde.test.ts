import { describe, it, expect } from 'vitest';
import { opVolgorde, schuif, type Medewerker } from '@/lib/rooster/types';
import { leesMedewerker } from '@/lib/store/db/tabellen';

const mw = (id: string, naam: string, extra: Partial<Medewerker> = {}): Medewerker => ({ id, regio: 'Utrecht', naam, contract: 32, voorkeur: 'O', weekendgroep: 0, functie: 'UV', actief: true, ...extra });

describe('volgorde van het team in het rooster', () => {
  const team = [mw('l1', 'Anna', { functie: 'UL' }), mw('v1', 'Bram'), mw('x', 'Aart', { extern: true }), mw('v2', 'Cor'), mw('l2', 'Dirk', { functie: 'UL' }), mw('v3', 'Adam')];
  const ids = (t: Medewerker[]) => [...t].sort(opVolgorde).map((m) => m.id);

  it('zonder gekozen volgorde: uitvaartverzorgers bovenaan, uitvaartleiders onderaan, externen helemaal onder, op naam', () => {
    expect(ids(team)).toEqual(['v3', 'v1', 'v2', 'l1', 'l2', 'x']);
  });

  it('schuiven binnen de eigen groep; over de grens van de groep kan niet', () => {
    const plek = schuif(team, 'v2', -1)!;
    expect(plek).toEqual({ v3: 1, v2: 2, v1: 3, l1: 4, l2: 5, x: 6 });
    const na = team.map((m) => ({ ...m, volgorde: plek[m.id] }));
    expect(ids(na)).toEqual(['v3', 'v2', 'v1', 'l1', 'l2', 'x']);
    expect(schuif(na, 'v3', -1)).toBeNull(); // bovenaan
    expect(schuif(na, 'v1', 1)).toBeNull(); // laatste uitvaartverzorger: de uitvaartleiders blijven onder
    expect(schuif(na, 'l1', -1)).toBeNull();
    expect(schuif(na, 'l1', 1)).toEqual({ v3: 1, v2: 2, v1: 3, l2: 4, l1: 5, x: 6 });
  });

  it('wie nieuw in het team komt, staat onderaan de eigen groep', () => {
    const na = team.map((m) => ({ ...m, volgorde: schuif(team, 'v2', -1)![m.id] }));
    expect(ids([...na, mw('v4', 'Aaron'), mw('l3', 'Aad', { functie: 'UL' })])).toEqual(['v3', 'v2', 'v1', 'v4', 'l1', 'l2', 'l3', 'x']);
  });

  it('een andere functie: dan in die groep', () => {
    expect(ids(team.map((m) => (m.id === 'v1' ? { ...m, functie: 'UL' as const } : m)))).toEqual(['v3', 'v2', 'l1', 'v1', 'l2', 'x']);
  });

  it('de volgorde komt uit de database terug, een lege blijft leeg', () => {
    const rij = { id: 'a', regio: 'Utrecht', naam: 'Bram', contract: 32, voorkeur: 'O', weekendgroep: 0, functie: 'UV', actief: true };
    expect(leesMedewerker({ ...rij, volgorde: 4 }).volgorde).toBe(4);
    expect('volgorde' in leesMedewerker({ ...rij, volgorde: null })).toBe(false);
  });
});
