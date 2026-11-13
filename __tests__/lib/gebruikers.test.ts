import { describe, it, expect } from 'vitest';
import { controleerInvoer, naarGebruiker, regioIds, ROL_NAAR_PROFIEL } from '@/lib/gebruikers';
import { rolUitProfiel } from '@/lib/sessie';
import { REGIONS } from '@/lib/model/config';
import { NBD, WERKREGIOS } from '@/lib/nbd/parameters';

const tabel = REGIONS.map((naam, i) => ({ id: i + 1, naam }));

describe('gebruikersbeheer', () => {
  it('elke rol in de app heeft een waarde in users.rol die weer dezelfde rol oplevert', () => {
    for (const [rol, profiel] of Object.entries(ROL_NAAR_PROFIEL)) expect(rolUitProfiel(profiel)).toBe(rol);
  });

  it('controleert de invoer: e-mail, naam, rol en bekende regio\'s; een medewerker hoort bij een regio', () => {
    expect(controleerInvoer({ email: ' Jan@voorbeeld.nl ', naam: 'Jan', rol: 'regiomanager', regios: ['Utrecht', 'Utrecht'] })).toEqual({ ok: true, invoer: { email: 'jan@voorbeeld.nl', naam: 'Jan', rol: 'regiomanager', regios: ['Utrecht'] } });
    // een planner en de beheerder hebben altijd alle regio's (leeg), ook als er regio's zijn meegestuurd
    expect(controleerInvoer({ email: 'p@voorbeeld.nl', naam: 'Piet', rol: 'planner', regios: ['Utrecht'] })).toMatchObject({ ok: true, invoer: { regios: [] } });
    expect(controleerInvoer({ email: 'b@voorbeeld.nl', naam: 'Bea', rol: 'beheerder', regios: ['Utrecht'] })).toMatchObject({ ok: true, invoer: { regios: [] } });
    expect(controleerInvoer({ email: 'geen-mail', naam: 'Jan', rol: 'planner', regios: [] })).toMatchObject({ ok: false });
    expect(controleerInvoer({ email: 'jan@voorbeeld.nl', naam: 'Jan', rol: 'baas', regios: [] })).toMatchObject({ ok: false, fout: 'Kies een rol' });
    expect(controleerInvoer({ email: 'jan@voorbeeld.nl', naam: 'Jan', rol: 'planner', regios: ['Atlantis'] })).toMatchObject({ ok: false, fout: 'Onbekende regio: Atlantis' });
    expect(controleerInvoer({ email: 'jan@voorbeeld.nl', naam: 'Jan', rol: 'medewerker', regios: [] })).toMatchObject({ ok: false });
    // een regiomanager zonder regio's zou in de database niets mogen; leeg is geen "alle regio's"
    expect(controleerInvoer({ email: 'rm@voorbeeld.nl', naam: 'Rianne', rol: 'regiomanager', regios: [] })).toMatchObject({ ok: false, fout: expect.stringContaining('regiomanager') });
    expect(controleerInvoer({ rol: 'regiomanager', regios: [] }, false)).toMatchObject({ ok: false });
    // bij aanpassen gaat het alleen om rol en regio's
    expect(controleerInvoer({ rol: 'regiomanager', regios: ['Utrecht'] }, false)).toMatchObject({ ok: true });
  });

  it('regio\'s als namen in de app en als id\'s in de tabel; een planner heeft altijd alle (lege lijst)', () => {
    expect(regioIds(['Utrecht', 'Atlantis'], tabel)).toEqual([tabel.find((r) => r.naam === 'Utrecht')!.id]);
    const g = naarGebruiker({ id: 'u1', naam: 'J. Kee', email: 'Jkee@voorbeeld.nl', rol: 'NBD Planner', regios: tabel.map((r) => r.id), auth_id: null }, tabel);
    expect(g).toMatchObject({ rol: 'planner', profielRol: 'NBD Planner', regios: [], gekoppeld: false });
    // een planner met één regio in de tabel heeft toch alle regio's; een regiomanager houdt de eigen
    const utrecht = tabel.find((r) => r.naam === 'Utrecht')!.id;
    expect(naarGebruiker({ id: 'u2', naam: 'P', email: 'p@voorbeeld.nl', rol: 'Regio Planner', regios: [utrecht], auth_id: null }, tabel).regios).toEqual([]);
    expect(naarGebruiker({ id: 'u3', naam: 'R', email: 'r@voorbeeld.nl', rol: 'Regio Manager', regios: [utrecht], auth_id: null }, tabel).regios).toEqual(['Utrecht']);
  });

  it('de nabestaandendesk is een eigen werkregio: los te kiezen, en hoort bij "alle regio\'s"', () => {
    const metNbd = [...tabel, { id: 99, naam: NBD }];
    expect(controleerInvoer({ email: 'n@voorbeeld.nl', naam: 'Nora', rol: 'regiomanager', regios: [NBD] })).toMatchObject({ ok: true, invoer: { regios: [NBD] } });
    expect(controleerInvoer({ email: 'm@voorbeeld.nl', naam: 'Mo', rol: 'medewerker', regios: [NBD] })).toMatchObject({ ok: true, invoer: { regios: [NBD] } });
    expect(regioIds([NBD], metNbd)).toEqual([99]);
    // alle regio's zonder de NBD is niet alles; met de NBD staan ze allemaal in de lijst (nooit een lege lijst)
    const rm = (regios: number[]) => naarGebruiker({ id: 'u4', naam: 'R', email: 'r@voorbeeld.nl', rol: 'Regio Manager', regios, auth_id: null }, metNbd).regios;
    expect(rm(tabel.map((r) => r.id))).toEqual(REGIONS);
    expect(rm(metNbd.map((r) => r.id))).toEqual(WERKREGIOS);
    expect(rm([99])).toEqual([NBD]);
    // zonder regio's, of met een id die nergens naar wijst: geen regio's
    expect(rm([])).toEqual([]);
    expect(rm([12345])).toEqual([]);
  });
});
