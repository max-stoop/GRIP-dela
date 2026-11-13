import { describe, expect, it } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { gesprekkenPerWeek, NBD, NBD_GESPREKKEN_STANDAARD, NBD_STANDAARD, nbdParameters, tijdvakken, uitvaartenPerJaar, type NbdParameters } from '@/lib/nbd/parameters';
import { gewoneDag, kwartierenOpen, nbdBehoefte, schaal, uitvaartenOp } from '@/lib/nbd/behoefte';
import { aanTelefoon, dagdeel, maakDienst, naarTijd, netto, pauzeBegin, pauzeNodig, type NbdDienst } from '@/lib/nbd/dienst';
import { blokkenVan, weekVan, weekrustOk } from '@/lib/nbd/blokken';
import { toetsNbd } from '@/lib/nbd/toets';
import { maakNbdRooster } from '@/lib/nbd/voorstel';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { addDays, isoRange, toDay, weekday } from '@/lib/dates';
import type { Cellen, Medewerker, Tijden, Voorkeurprofiel } from '@/lib/rooster/types';
import { LEEG_PROFIEL } from '@/lib/rooster/types';
import type { RunData } from '@/lib/model/types';

const P = NBD_STANDAARD;
let id = 0;
const maakId = () => `m${++id}`;
const mw = (naam: string, contract = 36, extra: Partial<Medewerker> = {}): Medewerker => ({ id: maakId(), regio: NBD, naam, contract, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra });

function zet(c: Cellen, t: Tijden, m: Medewerker, d: string, x: NbdDienst) {
  (c[m.id] ??= {})[d] = 'N';
  (t[m.id] ??= {})[d] = naarTijd(x);
}

describe('NBD-parameters en behoefte', () => {
  it('neemt het volume van de regio’s over: schaal 1 met de startwaarden', () => {
    // afgeronde startwaarden: op een paar honderdsten van een procent na hetzelfde volume
    expect(schaal(P, NORM_STANDAARD)).toBeCloseTo(1, 3);
    expect(uitvaartenPerJaar(P)).toBeCloseTo(40725, -1);
    expect(schaal({ ...P, natura: P.natura * 2, overlijdens: P.overlijdens * 2 }, NORM_STANDAARD)).toBeCloseTo(2, 3);
  });

  it('vult ontbrekende en kapotte waarden aan', () => {
    const p = nbdParameters({ aht: Number.NaN, open: 9, sluit: 5, maxDienst: 2, gesprekken: [[1, 2]] } as Partial<NbdParameters>);
    expect(p.aht).toBe(700);
    // de openingstijden liggen vast
    expect([p.open, p.sluit]).toEqual([7, 22.5]);
    expect(p.maxDienst).toBe(p.minDienst);
    expect(p.gesprekken).toEqual(NBD_GESPREKKEN_STANDAARD);
    expect(nbdParameters(null)).toEqual(NBD_STANDAARD);
    // wat is opgeslagen, blijft
    expect(nbdParameters({ aht: 650 }).aht).toBe(650);
  });

  it('rekent een gewone week precies zoals de capaciteitsplanning: Erlang per uur, naar boven afgerond', () => {
    // tabblad Benodigde uren: mensen per uur (7:00 ... 21:00 en 22:00-22:30), maandag eerst
    const BOEK: Record<number, number[]> = {
      1: [4, 7, 10, 9, 9, 8, 8, 7, 7, 7, 6, 5, 5, 5, 4, 3],
      2: [4, 7, 9, 9, 8, 7, 7, 7, 7, 7, 6, 4, 5, 5, 4, 3],
      3: [4, 7, 9, 8, 8, 7, 7, 7, 7, 7, 6, 5, 5, 5, 4, 3],
      4: [4, 7, 9, 8, 7, 7, 7, 7, 7, 7, 6, 5, 4, 5, 4, 3],
      5: [4, 7, 9, 8, 8, 7, 7, 7, 7, 7, 6, 5, 4, 5, 4, 3],
      6: [4, 6, 8, 8, 8, 7, 7, 7, 6, 6, 5, 5, 5, 4, 4, 3],
      0: [4, 5, 7, 7, 7, 7, 6, 6, 6, 5, 5, 4, 4, 4, 4, 3],
    };
    const UREN: Record<number, number> = { 1: 102.5, 2: 97.5, 3: 97.5, 4: 95.5, 5: 96.5, 6: 91.5, 0: 82.5 };
    let week = 0, gesprekken = 0;
    for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
      const dag = gewoneDag(P, wd);
      expect(dag.tijdvakken.map((v) => v.nodig)).toEqual(BOEK[wd]);
      expect(dag.uren).toBe(UREN[wd]);
      week += dag.uren;
      gesprekken += dag.gesprekken;
    }
    expect(week).toBe(663.5);
    expect(gesprekken).toBeCloseTo(1703.2, 1);
    expect(gesprekkenPerWeek(P)).toBeCloseTo(1703.2, 1);
    // open van 7:00 tot 22:30: 16 tijdvakken, het laatste een halfuur
    expect(tijdvakken(P).at(-1)).toEqual({ van: 22, tot: 22.5 });
    expect(tijdvakken(P)).toHaveLength(16);
  });

  it('beweegt mee met de overlijdens van de regio’s: gemiddeld een gewone week', () => {
    // over het hele jaar is de factor gemiddeld 1 (de vastgestelde regelplekken zijn het gemiddelde)
    const jaar = isoRange('2026-01-05', '2027-01-03');
    const b = nbdBehoefte({ norm: NORM_STANDAARD }, P, jaar, 'norm');
    const factoren = jaar.map((d) => b[d].factor);
    expect(factoren.reduce((a, f) => a + f, 0) / factoren.length).toBeCloseTo(schaal(P, NORM_STANDAARD), 2);
    // in de winter drukker dan in de zomer, zoals de overlijdens
    const gem = (van: string, tot: string) => { const ds = isoRange(van, tot); return ds.reduce((a, d) => a + b[d].gesprekken, 0) / ds.length; };
    expect(gem('2026-01-26', '2026-02-15')).toBeGreaterThan(gem('2026-08-31', '2026-09-13') * 1.15);
    // het aantal gesprekken is de gewone week maal de factor
    const d = '2026-11-03';
    expect(b[d].gesprekken).toBeCloseTo(gewoneDag(P, 2).gesprekken * b[d].factor, 6);
  });

  it('verdeelt de gesprekken over de open kwartieren en rekent per uur met Erlang', () => {
    const dates = isoRange('2026-11-02', '2026-11-08');
    const b = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');
    const week = dates.reduce((a, d) => a + b[d].gesprekken, 0);
    // een gewone week heeft 1.703 gesprekken; begin november iets meer
    expect(week).toBeGreaterThan(1600);
    expect(week).toBeLessThan(1900);
    for (const d of dates) {
      const dag = b[d];
      expect(dag.kwartieren.length).toBe(kwartierenOpen(P).length);
      expect(dag.kwartieren[0].t).toBe(7);
      expect(dag.kwartieren.at(-1)!.t).toBe(22.25);
      expect(dag.kwartieren.reduce((a, k) => a + k.gesprekken, 0)).toBeCloseTo(dag.gesprekken, 6);
      expect(Math.min(...dag.kwartieren.map((k) => k.nodig))).toBeGreaterThanOrEqual(P.minBezetting);
      expect(dag.uren).toBeCloseTo(dag.kwartieren.reduce((a, k) => a + k.nodig, 0) / 4, 9);
      expect(dag.bron).toBe('norm');
    }
    // maandagochtend om 9 uur is drukker dan om 7 uur
    const ma = b['2026-11-02'];
    expect(ma.kwartieren.find((k) => k.t === 9)!.nodig).toBeGreaterThan(ma.kwartieren.find((k) => k.t === 7)!.nodig);
  });

  it('volgt de voorspelling (bijsturing) als die er is', () => {
    const regios = Object.keys(NORM_STANDAARD.regios);
    const run: RunData = { id: 'r', dates: ['2026-11-02'], regios, lam: regios.map(() => [10]), base: regios.map(() => [10]), fac: {} };
    const u = uitvaartenOp({ norm: NORM_STANDAARD, laatste: run }, P, '2026-11-02', 'laatste');
    expect(u.bron).toBe('laatste');
    expect(u.uitvaarten).toBeCloseTo(10 * regios.length * schaal(P, NORM_STANDAARD), 6);
    expect(uitvaartenOp({ norm: NORM_STANDAARD, laatste: run }, P, '2026-11-03', 'laatste').bron).toBe('norm');
    // valt een dag buiten de laatste voorspelling, dan de roosterbasis (en pas daarna de norm)
    const basis: RunData = { ...run, id: 'b', dates: ['2026-11-03'] };
    expect(uitvaartenOp({ norm: NORM_STANDAARD, laatste: run, basis }, P, '2026-11-03', 'laatste').bron).toBe('basis');
    expect(uitvaartenOp({ norm: NORM_STANDAARD, laatste: run, basis }, P, '2026-11-02', 'basis').bron).toBe('laatste');
    const druk = nbdBehoefte({ norm: NORM_STANDAARD, laatste: { ...run, lam: regios.map(() => [20]) } }, P, ['2026-11-02'], 'laatste')['2026-11-02'];
    const rustig = nbdBehoefte({ norm: NORM_STANDAARD, laatste: run }, P, ['2026-11-02'], 'laatste')['2026-11-02'];
    expect(druk.uren).toBeGreaterThan(rustig.uren);
  });
});

describe('NBD-diensten', () => {
  it('zet de pauze erbij: meer dan 5,5 uur werk geeft 30 minuten, die niet meetellen', () => {
    expect(pauzeNodig(P, 5.5)).toBe(0);
    expect(pauzeNodig(P, 5.75)).toBe(30);
    expect(pauzeNodig(P, 10.5)).toBe(45);
    const x = maakDienst(P, 8, 8);
    expect(x).toMatchObject({ start: 8, eind: 16.5, pauze: 30 });
    expect(netto(x)).toBe(8);
    expect(pauzeBegin(x)).toBe(12);
    expect(aanTelefoon(x, 11.75)).toBe(true);
    expect(aanTelefoon(x, 12)).toBe(false);
    expect(aanTelefoon(x, 12.25)).toBe(false);
    expect(aanTelefoon(x, 12.5)).toBe(true);
    expect(aanTelefoon(x, 16.5)).toBe(false);
    expect(maakDienst(P, 18, 4)).toMatchObject({ start: 18, eind: 22, pauze: 0 });
  });

  it('kent dagdelen toe op waar de dienst het meest in valt', () => {
    expect(dagdeel({ start: 7, eind: 13 })).toBe('ochtend');
    expect(dagdeel({ start: 11, eind: 17 })).toBe('middag');
    expect(dagdeel({ start: 16, eind: 22.5 })).toBe('avond');
  });
});

describe('NBD-toets (ATW en CAO)', () => {
  const dates = isoRange('2026-11-02', '2026-11-15');
  const behoefte = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');

  it('vindt te weinig rust, een te korte of te lange dienst, een ontbrekende pauze en een dienst zonder tijden', () => {
    const a = mw('Anna'), b = mw('Bart'), c2 = mw('Cor'), d = mw('Dewi');
    const c: Cellen = {}, t: Tijden = {};
    zet(c, t, a, '2026-11-02', maakDienst(P, 15, 7)); // tot 22:30
    zet(c, t, a, '2026-11-03', maakDienst(P, 7, 6)); // 8,5 uur rust
    zet(c, t, b, '2026-11-02', maakDienst(P, 9, 2)); // te kort
    zet(c, t, b, '2026-11-04', maakDienst(P, 8, 10)); // te lang
    zet(c, t, c2, '2026-11-02', { start: 8, eind: 16, pauze: 0 }); // 8 uur zonder pauze
    (c[d.id] ??= {})['2026-11-02'] = 'N'; // geen tijden
    const r = toetsNbd({ team: [a, b, c2, d], dates, cellen: c, tijden: t, behoefte, p: P });
    const ids = r.checks.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['rust', 'kort', 'lang', 'pauze', 'geen-tijden']));
    expect(r.hard).toBeGreaterThanOrEqual(5);
    expect(r.cijfer).toBeLessThanOrEqual(5.5);
    expect(r.markering[a.id]['2026-11-03']).toBe('hard');
  });

  it('vraagt elke week 36 uur aaneengesloten rust en hoogstens 60 uur werk', () => {
    const a = mw('Anna', 40), b = mw('Bart', 40);
    const c: Cellen = {}, t: Tijden = {};
    // vier weken elke dag van 13:00 tot 22:00: nergens 36 uur rust (ook niet in de weken ervoor en erna)
    for (const d of isoRange('2026-10-26', '2026-11-22')) zet(c, t, a, d, maakDienst(P, 13, 8.5));
    // zeven dagen van 9 uur in één week: 63 uur
    for (const d of dates.slice(0, 7)) zet(c, t, b, d, maakDienst(P, 8, 9));
    const r = toetsNbd({ team: [a, b], dates, cellen: c, tijden: t, behoefte, p: { ...P, maxAchtereen: 14 } });
    const weekrust = r.checks.find((x) => x.id === 'weekrust')!;
    expect(weekrust.items.some((i) => i.startsWith('Anna'))).toBe(true);
    expect(r.checks.find((x) => x.id === 'weekuren')!.items.some((i) => i.startsWith('Bart'))).toBe(true);
  });

  it('een vrij weekend geeft genoeg weekrust; rust over de weekgrens telt mee', () => {
    const a = mw('Anna');
    const c: Cellen = {}, t: Tijden = {};
    for (const d of dates) if (weekday(toDay(d)) % 6 !== 0) zet(c, t, a, d, maakDienst(P, 8, 8));
    const blokken = blokkenVan(c, t, a.id);
    expect(weekrustOk(blokken, weekVan('2026-11-02'), P)).toBe(true);
    expect(weekrustOk(blokken, weekVan('2026-11-09'), P)).toBe(true);
    const r = toetsNbd({ team: [a], dates, cellen: c, tijden: t, behoefte, p: P });
    expect(r.hard).toBe(0);
  });

  it('toetst de vrije weekenden (CAO), behalve met een afstandsverklaring', () => {
    const a = mw('Anna'), b = mw('Bart', 36, { afstandsverklaring: true });
    const c: Cellen = {}, t: Tijden = {};
    // 27 gewerkte weekenden (zaterdag en zondag) in 2026
    let d = '2026-01-03';
    for (let i = 0; i < 27; i++, d = addDays(d, 7)) for (const x of [d, addDays(d, 1)]) { (c[a.id] ??= {})[x] = 'O'; (c[b.id] ??= {})[x] = 'O'; }
    const r = toetsNbd({ team: [a, b], dates: ['2026-07-04'], cellen: c, tijden: t, behoefte: {}, p: P, minVrijeWeekenden: 26 });
    const w = r.checks.find((x) => x.id === 'weekenden');
    expect(w?.items.some((i) => i.startsWith('Anna'))).toBe(true);
    expect(w?.items.some((i) => i.startsWith('Bart'))).toBe(false);
  });

  it('rekent dekking en service level per dag', () => {
    const team = Array.from({ length: 4 }, (_, i) => mw(`M${i}`));
    const c: Cellen = {}, t: Tijden = {};
    const d = '2026-11-02';
    team.forEach((m, i) => zet(c, t, m, d, maakDienst(P, i < 2 ? 7 : 14, 8)));
    const r = toetsNbd({ team, dates: [d], cellen: c, tijden: t, behoefte, p: P });
    const dag = r.perDag[0];
    expect(dag.diensten).toBe(4);
    expect(dag.gepland[0]).toBe(2);
    expect(dag.tekortUren).toBeGreaterThan(0);
    expect(dag.sl).toBeGreaterThan(0);
    expect(dag.sl).toBeLessThan(P.serviceLevel);
  });
});

describe('NBD-rooster automatisch maken', () => {
  const dates = isoRange('2026-11-01', '2026-11-30');
  const behoefte = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');
  const team = voorbeeldTeam(NBD, maakId);

  function toepassen(c0: Cellen, t0: Tijden, w: ReturnType<typeof maakNbdRooster>['wijzigingen']) {
    const c: Cellen = JSON.parse(JSON.stringify(c0)), t: Tijden = JSON.parse(JSON.stringify(t0));
    for (const [mid, d, code, x] of w) {
      if (code === '-') delete (c[mid] ??= {})[d]; else (c[mid] ??= {})[d] = code;
      if (x) (t[mid] ??= {})[d] = naarTijd(x); else delete (t[mid] ??= {})[d];
    }
    return { c, t };
  }

  it('maakt een rooster zonder overtredingen van ATW en CAO dat Erlang grotendeels dekt', () => {
    const v = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte, p: P, modus: 'opnieuw', minVrijeWeekenden: 26 });
    const { c, t } = toepassen({}, {}, v.wijzigingen);
    const r = toetsNbd({ team, dates, cellen: c, tijden: t, behoefte, p: P, minVrijeWeekenden: 26 });
    expect(r.checks.filter((x) => x.hard)).toEqual([]);
    expect(r.sub.cont).toBeGreaterThan(0.9);
    expect(r.sl).toBeGreaterThan(0.75);
    for (const [, , code, x] of v.wijzigingen) {
      if (code !== 'N') continue;
      expect(netto(x!)).toBeGreaterThanOrEqual(P.minDienst);
      expect(netto(x!)).toBeLessThanOrEqual(P.maxDienst);
      expect(x!.pauze).toBeGreaterThanOrEqual(pauzeNodig(P, netto(x!)));
      expect(x!.start).toBeGreaterThanOrEqual(P.open);
      expect(x!.eind).toBeLessThanOrEqual(P.sluit);
    }
    // contracturen: niemand boven zijn contract in een week
    expect(r.checks.find((x) => x.id === 'contract')).toBeUndefined();
  });

  it('houdt rekening met verlof, kan-niet-dagen, wensen en het dagdeel', () => {
    const [a, b] = team;
    const cellen: Cellen = { [a.id]: Object.fromEntries(isoRange('2026-11-09', '2026-11-13').map((d) => [d, 'V'])) };
    const profielen: Record<string, Voorkeurprofiel> = {
      [b.id]: { ...LEEG_PROFIEL(b.id), dagen: ['niet', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'neutraal', 'niet'], dienst: 'avond' },
    };
    const wensen = [{ id: 'w1', medewerkerId: b.id, regio: NBD, datum: '2026-11-04', soort: 'vrij' as const, gemaakt: '' }];
    const v = maakNbdRooster({ team, dates, cellen, tijden: {}, behoefte, p: P, modus: 'opnieuw', profielen, wensen });
    const { c, t } = toepassen(cellen, {}, v.wijzigingen);
    for (const d of isoRange('2026-11-09', '2026-11-13')) expect(c[a.id][d]).toBe('V');
    for (const d of dates) if ([0, 6].includes(weekday(toDay(d)))) expect(c[b.id]?.[d] ?? '-').not.toBe('N');
    expect(c[b.id]?.['2026-11-04'] ?? '-').toBe('-');
    const diensten = dates.map((d) => t[b.id]?.[d]).filter(Boolean);
    expect(diensten.length).toBeGreaterThan(0);
    const avond = diensten.filter((x) => dagdeel(x!) === 'avond').length;
    expect(avond / diensten.length).toBeGreaterThan(0.5);
  });

  it('laat bij aanvullen bestaande diensten staan', () => {
    const [a] = team;
    const c0: Cellen = {}, t0: Tijden = {};
    zet(c0, t0, a, '2026-11-03', maakDienst(P, 10, 6));
    const v = maakNbdRooster({ team, dates, cellen: c0, tijden: t0, behoefte, p: P, modus: 'aanvullen' });
    expect(v.wijzigingen.some(([mid, d]) => mid === a.id && d === '2026-11-03')).toBe(false);
    const { c, t } = toepassen(c0, t0, v.wijzigingen);
    expect(t[a.id]['2026-11-03']).toMatchObject({ start: 10, eind: 16.5 });
    expect(c[a.id]['2026-11-03']).toBe('N');
  });

  it('is reproduceerbaar en snel', () => {
    const t0 = Date.now();
    const a = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte, p: P, modus: 'opnieuw' });
    const duur = Date.now() - t0;
    const b = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte, p: P, modus: 'opnieuw' });
    expect(a.wijzigingen).toEqual(b.wijzigingen);
    expect(duur).toBeLessThan(8000);
  });
});
