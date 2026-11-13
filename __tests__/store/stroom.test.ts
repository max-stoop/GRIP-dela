import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  accepteerRuil, beoordeelRuil, beoordeelVerlof, bewaarMedewerker, getState, herstelZiek, ingeroosterdOp, maakRuil, maakVerlofRuil, meldZiek,
  pasBijsturingToe, trekVerlofIn, verloopRuilen, verwijderMedewerker,
  openVakantieronde, besluitVakantieronde, toetsRuil, vraagVerlofAan, zetCellen,
  aangepastNaAdvies, beoordeelRooster, goedkeuringVan, maandVastgesteld, publiceer, vraagGoedkeuring, zetTijd,
} from '@/lib/store/store';
import { addDays, fromDay, isoRange, mondayOf, toDay, todayIso } from '@/lib/dates';
import { DIENSTEN } from '@/lib/rooster/diensten';
import { maandEind, maandNaam, maandStart, maandVan, volgendeMaand } from '@/lib/rooster/maand';
import type { Wijziging } from '@/lib/rooster/voorstel';

// zonder IndexedDB (jsdom) mislukt het wegschrijven; de toestand in het geheugen is wat we testen
beforeAll(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });

const regio = 'Utrecht';
const maandag = (weken: number) => fromDay(mondayOf(toDay(todayIso())) + 7 * weken);
const plekken = (d: string) => {
  const s = getState();
  return s.medewerkers.filter((m) => m.regio === regio).reduce((a, m) => a + DIENSTEN[s.rooster[regio]?.[m.id]?.[d] ?? '-'].plekken, 0);
};

describe('verlof ruilen', () => {
  const a = bewaarMedewerker({ regio, naam: 'Anouk', contract: 32, voorkeur: 'O', weekendgroep: 0 });
  const b = bewaarMedewerker({ regio, naam: 'Bas', contract: 32, voorkeur: 'M', weekendgroep: 1 });
  const p1 = isoRange(maandag(3), addDays(maandag(3), 4)), p2 = isoRange(maandag(6), addDays(maandag(6), 4));
  // beide werken ma t/m do in beide weken
  const w: Wijziging[] = [];
  for (const d of [...p1, ...p2].filter((_, i) => i % 5 !== 4)) w.push([a, d, '1'], [b, d, '1M']);
  zetCellen(regio, w);
  const va = vraagVerlofAan({ medewerkerId: a, van: p1[0], tot: p1[4], soort: 'vakantie' }, 'test');
  const vb = vraagVerlofAan({ medewerkerId: b, van: p2[0], tot: p2[4], soort: 'vakantie' }, 'test');
  beoordeelVerlof(va.id, 'goedgekeurd', 'planner');
  beoordeelVerlof(vb.id, 'goedgekeurd', 'planner');
  const voor = [...p1, ...p2].map(plekken);

  it('alleen goedgekeurd verlof van collega’s in de eigen regio', () => {
    const c = bewaarMedewerker({ regio: 'Friesland', naam: 'Carlijn', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const vc = vraagVerlofAan({ medewerkerId: c, van: p2[0], tot: p2[4], soort: 'vakantie' }, 'test');
    expect(() => maakVerlofRuil({ aanbiederId: a, verlofId: va.id, ontvangerId: c, tegenVerlofId: vc.id }, 'test')).toThrow();
  });

  it('collega gaat akkoord, de planner keurt goed: periodes en roosterrijen wisselen', () => {
    const r = maakVerlofRuil({ aanbiederId: a, verlofId: va.id, ontvangerId: b, tegenVerlofId: vb.id, opmerking: 'kamp' }, 'Anouk');
    expect(r.soort).toBe('verlof');
    expect([r.tot, r.tegenTot]).toEqual([p1[4], p2[4]]);
    expect(toetsRuil(r, b).ok).toBe(true);
    expect(() => maakVerlofRuil({ aanbiederId: a, verlofId: va.id, ontvangerId: b, tegenVerlofId: vb.id }, 'Anouk')).toThrow(/loopt al/);

    accepteerRuil(r.id, b, 'Bas');
    expect(getState().ruil.find((x) => x.id === r.id)!.status).toBe('wacht_planner');
    beoordeelRuil(r.id, 'goedgekeurd', 'planner');

    const s = getState();
    const na = (mid: string, d: string) => s.rooster[regio][mid]?.[d] ?? '-';
    // Anouk heeft nu verlof in de tweede periode en werkt in de eerste (de diensten van Bas)
    expect(p2.every((d) => na(a, d) === 'V')).toBe(true);
    expect(p1.every((d) => na(b, d) === 'V')).toBe(true);
    expect(na(a, p1[0])).toBe('1M');
    expect(s.verlof.find((v) => v.id === va.id)).toMatchObject({ van: p2[0], tot: p2[4] });
    expect(s.verlof.find((v) => v.id === vb.id)).toMatchObject({ van: p1[0], tot: p1[4] });
    // de bezetting per dag blijft gelijk
    expect([...p1, ...p2].map(plekken)).toEqual(voor);
  });
});

describe('ziekmelding', () => {
  const m = bewaarMedewerker({ regio, naam: 'Daan', contract: 36, voorkeur: 'O', weekendgroep: 0 });
  const dagen = isoRange(addDays(todayIso(), 1), addDays(todayIso(), 3));
  zetCellen(regio, [[m, dagen[0], '1'], [m, dagen[2], 'DG2']]);

  it('werkdiensten worden Z en komen terug bij herstel', () => {
    const z = meldZiek(m, dagen[0], dagen[2], 'planner');
    expect(Object.keys(z.vervangen)).toEqual([dagen[0], dagen[2]]);
    expect(getState().rooster[regio][m][dagen[0]]).toBe('Z');
    expect(getState().rooster[regio][m][dagen[1]]).toBeUndefined();
    herstelZiek(z.id, dagen[2], 'planner');
    expect(getState().rooster[regio][m][dagen[0]]).toBe('Z'); // vóór de hersteldatum blijft ziek staan
    expect(getState().rooster[regio][m][dagen[2]]).toBe('DG2');
    expect(getState().ziekmeldingen.find((x) => x.id === z.id)!.status).toBe('hersteld');
  });
});

describe('vakantieronde', () => {
  const m = bewaarMedewerker({ regio, naam: 'Els', contract: 32, voorkeur: 'O', weekendgroep: 0 });
  const van = addDays(todayIso(), 200), tot = addDays(todayIso(), 250);

  it('aanvragen in de periode horen bij de ronde en worden samen besloten', () => {
    const ronde = openVakantieronde({ naam: 'Zomer', cluster: 'O', van, tot, data: { aanvragen: addDays(todayIso(), 30), analyse: addDays(todayIso(), 40), advies: addDays(todayIso(), 45), gesprek: addDays(todayIso(), 50), besluit: addDays(todayIso(), 60) } }, 'planner');
    const v = vraagVerlofAan({ medewerkerId: m, van: addDays(van, 5), tot: addDays(van, 11), soort: 'vakantie' }, 'Els');
    expect(v.rondeId).toBe(ronde.id);
    besluitVakantieronde(ronde.id, { [v.id]: 'goedgekeurd' }, 'planner');
    const s = getState();
    expect(s.verlof.find((x) => x.id === v.id)!.status).toBe('goedgekeurd');
    expect(s.vakantierondes.find((x) => x.id === ronde.id)!.fase).toBe('besloten');
  });
});

describe('vaststellen per maand en publiceren (§ 5.1)', () => {
  const r2 = 'Groningen';
  const a = bewaarMedewerker({ regio: r2, naam: 'Gerrit', contract: 32, voorkeur: 'O', weekendgroep: 0 });
  const b = bewaarMedewerker({ regio: r2, naam: 'Hilde', contract: 32, voorkeur: 'O', weekendgroep: 0 });
  const vandaag = todayIso();
  const M0 = maandVan(vandaag), M1 = volgendeMaand(M0), M2 = volgendeMaand(M1), M3 = volgendeMaand(M2);
  const tot = maandEind(M1);
  const d1 = addDays(maandStart(M1), 1), d2 = addDays(maandStart(M1), 2);
  const toets = { cijfer: 8.4, hard: 0 }, groen = { kleur: 'groen' as const };
  zetCellen(r2, [[a, d1, '1'], [b, d1, '1M'], [a, d2, 'DG2']]);

  it('publiceren kan pas als elke maand een advies en goedkeuring heeft; daarna blijft die vastgesteld, ook na een aanpassing', () => {
    expect(() => publiceer(r2, vandaag, tot, 'planner')).toThrow(new RegExp(`${maandNaam(M0)} is nog niet vastgesteld`));
    vraagGoedkeuring(r2, M0, toets, 'planner', groen);
    beoordeelRooster(r2, M0, 'goedgekeurd', 'regiomanager');
    expect(() => publiceer(r2, vandaag, tot, 'planner')).toThrow(new RegExp(`${maandNaam(M1)} is nog niet vastgesteld`));
    expect(() => vraagGoedkeuring(r2, M1, { cijfer: 5.4, hard: 1 }, 'planner', groen)).toThrow(/ATW/);
    vraagGoedkeuring(r2, M1, toets, 'planner', groen);
    // na het advies nog aangepast: geen nieuw advies nodig, de regiomanager ziet het wel
    zetCellen(r2, [[b, d2, 'DG2']]);
    expect(aangepastNaAdvies(r2, M1)).toBe(true);
    beoordeelRooster(r2, M1, 'goedgekeurd', 'regiomanager');
    expect(maandVastgesteld(r2, M1)).toBe(true);
    // een aanpassing na de vaststelling: blijft vastgesteld en kan zo worden gepubliceerd
    zetCellen(r2, [[b, d2, '-']]);
    expect(maandVastgesteld(r2, M1)).toBe(true);
    expect(() => vraagGoedkeuring(r2, M1, toets, 'planner', groen)).toThrow(/al vastgesteld/);
    publiceer(r2, vandaag, tot, 'planner');
    expect(getState().publicaties[r2].cellen[a][d1]).toBe('1');
    expect(getState().publicaties[r2].cellen[b]?.[d2]).toBeUndefined();
  });

  it('elke maand krijgt een eigen advies; een vastgestelde maand blijft gelden als de volgende wordt afgekeurd', () => {
    expect(() => publiceer(r2, maandStart(M2), maandEind(M2), 'planner')).toThrow(/niet vastgesteld/);
    vraagGoedkeuring(r2, M2, { cijfer: 8.2, hard: 0 }, 'planner', { kleur: 'oranje', toelichting: 'Week 5 is krap in de regio' });
    expect(() => publiceer(r2, maandStart(M2), maandEind(M2), 'planner')).toThrow(/niet vastgesteld/);
    beoordeelRooster(r2, M2, 'afgekeurd', 'regiomanager', 'Eerst de krappe week oplossen');
    expect(maandVastgesteld(r2, M1)).toBe(true);
    expect(goedkeuringVan(r2, M2)!.status).toBe('afgekeurd');
    vraagGoedkeuring(r2, M2, { cijfer: 8.6, hard: 0 }, 'planner', groen);
    beoordeelRooster(r2, M2, 'goedgekeurd', 'regiomanager');
    expect(goedkeuringVan(r2, M2)!.geschiedenis.map((x) => x.soort)).toEqual(['advies', 'afgekeurd', 'advies', 'goedgekeurd']);
  });

  it('bij elk rooster een advies van de planner: oranje en rood met toelichting, goedkeuren tegen rood in ook', () => {
    expect(() => vraagGoedkeuring(r2, M3, toets, 'planner', undefined as never)).toThrow(/advies/);
    expect(() => vraagGoedkeuring(r2, M3, toets, 'planner', { kleur: 'oranje' })).toThrow(/toe/);
    vraagGoedkeuring(r2, M3, toets, 'Plan', { kleur: 'rood', toelichting: '  Drie dagen niet te dekken  ', voorstel: 'oranje' });
    expect(goedkeuringVan(r2, M3)!.advies).toMatchObject({ kleur: 'rood', toelichting: 'Drie dagen niet te dekken', voorstel: 'oranje', door: 'Plan' });
    expect(() => beoordeelRooster(r2, M3, 'goedgekeurd', 'regiomanager')).toThrow(/rood/);
    expect(() => beoordeelRooster(r2, M3, 'afgekeurd', 'regiomanager')).toThrow(/anders/);
    beoordeelRooster(r2, M3, 'goedgekeurd', 'regiomanager', 'Externe geregeld');
    expect(maandVastgesteld(r2, M3)).toBe(true);
  });

  it('publiceren sluit aan zonder gat', () => {
    expect(() => publiceer(r2, maandStart(M3), maandEind(M3), 'planner')).toThrow(/geen gat/);
    publiceer(r2, maandStart(M2), maandEind(M3), 'planner');
    expect(getState().publicaties[r2]).toMatchObject({ van: vandaag, tot: maandEind(M3) });
  });

  it('een voorbije of onbekende maand bied je niet aan', () => {
    const vorige = volgendeMaand(M0, -1);
    expect(() => vraagGoedkeuring(r2, vorige, toets, 'planner', groen)).toThrow(/voorbij/);
    expect(() => vraagGoedkeuring(r2, '2026-13', toets, 'planner', groen)).toThrow(/Onbekende/);
  });

  it('ziekte gaat meteen het gepubliceerde rooster in en de maand blijft vastgesteld', () => {
    meldZiek(a, d1, d1, 'planner');
    expect(getState().publicaties[r2].cellen[a][d1]).toBe('Z');
    expect(maandVastgesteld(r2, M1)).toBe(true);
  });

  it('na advies en vaststelling kunnen medewerkers gewoon ruilen', () => {
    const d3 = addDays(maandStart(M1), 5);
    zetCellen(r2, [[a, d3, '1']]);
    const r = maakRuil({ soort: 'aanbieden', aanbiederId: a, datum: d3, dienst: '1' } as never, 'Gerrit');
    accepteerRuil(r.id, b, 'Hilde');
    beoordeelRuil(r.id, 'goedgekeurd', 'planner');
    expect(getState().rooster[r2][b][d3]).toBe('1');
    expect(getState().publicaties[r2].cellen[b][d3]).toBe('1');
    expect(maandVastgesteld(r2, M1)).toBe(true);
  });
});

describe('diensttijden', () => {
  const r3 = 'Amsterdam';
  const m = bewaarMedewerker({ regio: r3, naam: 'Ilona', contract: 32, voorkeur: 'O', weekendgroep: 0 });
  const straks = addDays(todayIso(), 6);
  zetCellen(r3, [[m, straks, 'DG2']]);

  it('diensttijden vastleggen binnen de kaders van de ATW', () => {
    expect(() => zetTijd(r3, m, straks, { start: 8, eind: 21 }, 'planner')).toThrow(/12 uur/);
    expect(() => zetTijd(r3, m, addDays(straks, 1), { start: 9, eind: 17 }, 'planner')).toThrow(/geen dienst/);
    zetTijd(r3, m, straks, { start: 10, eind: 18 }, 'planner');
    expect(getState().tijden[r3][m][straks]).toEqual({ start: 10, eind: 18, code: 'DG2' });
    zetTijd(r3, m, straks, null, 'planner');
    expect(getState().tijden[r3][m][straks]).toBeUndefined();
  });
});

describe('fouten uit de controle', () => {
  const r4 = 'Rotterdam';
  const vandaag = todayIso(), gisteren = addDays(vandaag, -1), morgen = addDays(vandaag, 1);

  it('lopend verlof intrekken laat het verleden staan en kort het verlof in', () => {
    const m = bewaarMedewerker({ regio: r4, naam: 'Jet', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    zetCellen(r4, [[m, gisteren, '1'], [m, morgen, '1M']]);
    const v = vraagVerlofAan({ medewerkerId: m, van: gisteren, tot: morgen, soort: 'vakantie' }, 't');
    beoordeelVerlof(v.id, 'goedgekeurd', 't');
    trekVerlofIn(v.id, 't');
    const s = getState();
    expect(s.rooster[r4][m][gisteren]).toBe('V');
    expect(s.rooster[r4][m][morgen]).toBe('1M');
    expect(s.verlof.find((x) => x.id === v.id)).toMatchObject({ status: 'goedgekeurd', van: gisteren, tot: gisteren });
    expect(() => trekVerlofIn(v.id, 't')).toThrow(/voorbij/);
  });

  it('een ruil gaat niet door als de dienst intussen is gewijzigd of de dag voorbij is', () => {
    const a = bewaarMedewerker({ regio: r4, naam: 'Kees', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const b = bewaarMedewerker({ regio: r4, naam: 'Lies', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const d = addDays(vandaag, 3);
    zetCellen(r4, [[a, d, '1']]);
    const r = maakRuil({ soort: 'aanbieden', aanbiederId: a, datum: d, dienst: '1' } as never, 'Kees');
    accepteerRuil(r.id, b, 'Lies');
    zetCellen(r4, [[a, d, 'DG2']]);
    expect(() => beoordeelRuil(r.id, 'goedgekeurd', 'planner')).toThrow(/gewijzigd/);
    expect(getState().ruil.find((x) => x.id === r.id)!.status).toBe('verlopen');
    expect(getState().rooster[r4][a][d]).toBe('DG2');
    expect(getState().rooster[r4][b]?.[d]).toBeUndefined();
    // een open aanbod van een dag die voorbij is, verloopt vanzelf
    zetCellen(r4, [[a, gisteren, '1']]);
    const oud = maakRuil({ soort: 'aanbieden', aanbiederId: a, datum: gisteren, dienst: '1' } as never, 'Kees');
    verloopRuilen();
    expect(getState().ruil.find((x) => x.id === oud.id)).toMatchObject({ status: 'verlopen', reden: 'de dag is al voorbij' });
  });

  it('wie uit het team gaat, laat geen verlof, aanvragen of ruilen achter', () => {
    const m = bewaarMedewerker({ regio: 'Friesland', naam: 'Mo', contract: 36, voorkeur: 'O', weekendgroep: 0 });
    const c = bewaarMedewerker({ regio: 'Friesland', naam: 'Noor', contract: 36, voorkeur: 'O', weekendgroep: 0 });
    const ma = '2026-11-16';
    const v = vraagVerlofAan({ medewerkerId: m, van: ma, tot: '2026-11-20', soort: 'vakantie' }, 't');
    beoordeelVerlof(v.id, 'goedgekeurd', 't');
    const aanvraag = vraagVerlofAan({ medewerkerId: m, van: '2026-12-07', tot: '2026-12-08', soort: 'adv' }, 't');
    zetCellen('Friesland', [[m, addDays(vandaag, 4), '1']]);
    const r = maakRuil({ soort: 'aanbieden', aanbiederId: m, datum: addDays(vandaag, 4), dienst: '1' } as never, 'Mo');
    verwijderMedewerker(m);
    const s = getState();
    expect(s.verlof.find((x) => x.id === v.id)!.status).toBe('ingetrokken');
    expect(s.verlof.find((x) => x.id === aanvraag.id)!.status).toBe('ingetrokken');
    expect(s.ruil.find((x) => x.id === r.id)!.status).toBe('ingetrokken');
    void c;
  });

  it('herstel na ziekte zet de dienst niet terug als een collega hem al overnam', () => {
    const a = bewaarMedewerker({ regio: 'Haaglanden', naam: 'Olaf', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const b = bewaarMedewerker({ regio: 'Haaglanden', naam: 'Pien', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const d1 = addDays(vandaag, 2), d2 = addDays(vandaag, 3);
    zetCellen('Haaglanden', [[a, d1, '1'], [a, d2, '1']]);
    const z = meldZiek(a, d1, d2, 'planner');
    // bijsturen: Pien neemt de dienst van d1 over
    pasBijsturingToe('Haaglanden', [[b, d1, '1']], 'Pien neemt over', 'planner');
    herstelZiek(z.id, d1, 'planner');
    const s = getState();
    expect(s.rooster['Haaglanden'][a][d1] ?? '-').toBe('-');
    expect(s.rooster['Haaglanden'][b][d1]).toBe('1');
    expect(s.rooster['Haaglanden'][a][d2]).toBe('1');
  });
});

describe('verlof na een goedgekeurd rooster gaat via een ruil', () => {
  it('op een dag met een dienst in het gepubliceerde rooster kan de medewerker geen verlof aanvragen; de planner wel invoeren', () => {
    const r = 'Zeeland';
    const a = bewaarMedewerker({ regio: r, naam: 'Vera Vast', contract: 32, voorkeur: 'O', weekendgroep: 0 });
    const dag = addDays(todayIso(), 20), vrij = addDays(dag, 1);
    zetCellen(r, [[a, dag, '1']]);
    // publiceren kan pas na advies en goedkeuring: gepubliceerd is dus goedgekeurd
    for (let m = maandVan(todayIso()); m <= maandVan(addDays(todayIso(), 40)); m = volgendeMaand(m)) {
      vraagGoedkeuring(r, m, { cijfer: 8, hard: 0 }, 'planner', { kleur: 'groen' });
      beoordeelRooster(r, m, 'goedgekeurd', 'regiomanager');
    }
    publiceer(r, todayIso(), addDays(todayIso(), 40), 'planner');
    expect(ingeroosterdOp(a, dag, vrij)).toEqual([dag]);
    expect(() => vraagVerlofAan({ medewerkerId: a, van: dag, tot: vrij, soort: 'vakantie' }, 'Vera')).toThrow(/al goedgekeurd.*via een ruil/);
    // een dag zonder dienst, of na de gepubliceerde periode: gewoon aanvragen
    expect(vraagVerlofAan({ medewerkerId: a, van: vrij, tot: vrij, soort: 'adv' }, 'Vera').status).toBe('aangevraagd');
    expect(vraagVerlofAan({ medewerkerId: a, van: addDays(todayIso(), 60), tot: addDays(todayIso(), 62), soort: 'vakantie' }, 'Vera').status).toBe('aangevraagd');
    // wie plant, kan het nog invoeren (bijvoorbeeld bijzonder verlof)
    expect(vraagVerlofAan({ medewerkerId: a, van: dag, tot: dag, soort: 'bijzonder' }, 'planner', { planner: true }).status).toBe('aangevraagd');
  });
});
