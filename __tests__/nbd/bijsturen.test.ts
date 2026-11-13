import { describe, expect, it } from 'vitest';
import { NORM_STANDAARD } from '@/lib/capaciteit/parameters';
import { NBD, NBD_STANDAARD } from '@/lib/nbd/parameters';
import { dagUitFactor, kwartierenOpen, nbdBehoefte, type NbdDag } from '@/lib/nbd/behoefte';
import { maakDienst, naarTijd, netto, pauzeBegin, pauzeNodig, type NbdDienst } from '@/lib/nbd/dienst';
import { nbdBijsturen, type NbdActieSoort } from '@/lib/nbd/bijsturen';
import { maakNbdRooster } from '@/lib/nbd/voorstel';
import { toetsNbd } from '@/lib/nbd/toets';
import { voorbeeldTeam } from '@/lib/rooster/demo';
import { isoRange, toDay, weekday } from '@/lib/dates';
import { STANDAARD_BELEID, type Cellen, type Medewerker, type Tijden } from '@/lib/rooster/types';

const P = NBD_STANDAARD;
let n = 0;
const maakId = () => `b${++n}`;
const mw = (naam: string, extra: Partial<Medewerker> = {}): Medewerker => ({ id: maakId(), regio: NBD, naam, contract: 36, voorkeur: 'O', weekendgroep: 0, actief: true, ...extra });
const ORDE: NbdActieSoort[] = ['pauze', 'taak', 'verlengen', 'inplannen', 'extern', 'terugbellen', 'inkorten', 'vrijgeven'];

function zet(c: Cellen, t: Tijden, m: Medewerker, d: string, x: NbdDienst) {
  (c[m.id] ??= {})[d] = 'N';
  (t[m.id] ??= {})[d] = naarTijd(x);
}

/** De behoefte als de bijvoorspelling factor keer zoveel gesprekken verwacht. */
function maal(b: Record<string, NbdDag>, factor: number) {
  return Object.fromEntries(Object.entries(b).map(([d, x]) => {
    const gewoon = (P.gesprekken[weekday(toDay(d))] ?? []).reduce((a, g) => a + g, 0);
    return [d, dagUitFactor(P, d, gewoon > 0 ? (x.gesprekken * factor) / gewoon : 0, x.uitvaarten * factor, 'laatste')];
  }));
}

describe('NBD bijsturen: rooster tegenover de bijvoorspelling', () => {
  const dates = isoRange('2026-11-02', '2026-11-08');
  const basis = nbdBehoefte({ norm: NORM_STANDAARD }, P, dates, 'norm');
  const team = [...voorbeeldTeam(NBD, maakId), mw('Ellen (ZZP)', { extern: true, contract: 24 })];
  const v = maakNbdRooster({ team, dates, cellen: {}, tijden: {}, behoefte: basis, p: P, modus: 'opnieuw', minVrijeWeekenden: 0, totContract: false });
  const cellen: Cellen = {}, tijden: Tijden = {};
  for (const [mid, d, , x] of v.wijzigingen) if (x) zet(cellen, tijden, team.find((m) => m.id === mid)!, d, x);
  const opties = { team, cellen, tijden, dates, basis, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-20', zzp: true };

  it('volgens de roosterbasis is er (bijna) niets te doen', () => {
    const b = nbdBijsturen({ ...opties, nu: basis });
    expect(b.samenvatting.tekortDagen).toBeLessThanOrEqual(1);
    expect(b.samenvatting.teveelDagen).toBe(0);
    expect(b.samenvatting.urenOmhoog).toBe(0);
    expect(b.samenvatting.gesprekkenVerschil).toBeCloseTo(0, 6);
  });

  it('meer gesprekken: tekort, met acties in de volgorde van het stroomschema, vooraf getoetst', () => {
    const nu = maal(basis, 1.3);
    const b = nbdBijsturen({ ...opties, nu });
    expect(b.samenvatting.tekortDagen).toBeGreaterThanOrEqual(5);
    expect(b.samenvatting.urenOmhoog).toBe(7);
    expect(b.samenvatting.gesprekkenVerschil).toBeCloseTo(0.3, 6);
    const tekort = b.dagen.filter((d) => d.status === 'tekort');
    const gezien = new Set<NbdActieSoort>();
    for (const dag of tekort) {
      const soorten = dag.acties.map((a) => a.soort);
      expect([...soorten].sort((a, c) => ORDE.indexOf(a) - ORDE.indexOf(c))).toEqual(soorten);
      for (const a of dag.acties) {
        gezien.add(a.soort);
        if (!a.wijzigingen.length) continue;
        expect(a.bevindingen.some((x) => x.ernst === 'hard')).toBe(false);
        for (const [, d, code, x] of a.wijzigingen) {
          expect(d).toBe(dag.datum);
          expect(code).toBe('N');
          expect(netto(x!)).toBeGreaterThanOrEqual(P.minDienst);
          expect(netto(x!)).toBeLessThanOrEqual(P.maxDienst);
          expect(x!.pauze).toBeGreaterThanOrEqual(pauzeNodig(P, netto(x!)));
          expect(x!.start).toBeGreaterThanOrEqual(P.open);
          expect(x!.eind).toBeLessThanOrEqual(P.sluit);
        }
        if (a.soort !== 'pauze') { expect(a.uren).toBeGreaterThan(0); expect(a.slNa!).toBeGreaterThan(dag.sl); }
        // een vrije dag inzetten binnen 28 dagen alleen in overleg; andere tijden na 4 dagen wel zonder
        if (a.soort === 'inplannen' || a.soort === 'extern') expect(a.overleg).toBe(true);
        if (a.soort === 'verlengen') expect(a.overleg).toBe(false);
      }
    }
    expect([...gezien]).toEqual(expect.arrayContaining(['verlengen', 'inplannen', 'extern']));
    // voorlopig staan externen niet in het rooster: dan stelt bijsturen ze ook niet voor
    const zonder = nbdBijsturen({ ...opties, zzp: undefined, nu });
    expect(zonder.dagen.flatMap((d) => d.acties).some((a) => a.soort === 'extern')).toBe(false);
    // het rooster zelf blijft ongemoeid
    expect(cellen).toEqual(Object.fromEntries(Object.entries(cellen)));
  });

  it('binnen 4 dagen kan een dienst alleen in overleg langer', () => {
    const b = nbdBijsturen({ ...opties, nu: maal(basis, 1.3), vandaag: '2026-11-01' });
    const ma = b.dagen[0];
    expect(ma.binnenTijden).toBe(true);
    expect(ma.acties.filter((a) => a.soort === 'verlengen').every((a) => a.overleg)).toBe(true);
  });

  it('minder gesprekken: te veel, met inkorten en vrij geven zonder dat het service level onder het doel zakt', () => {
    const b = nbdBijsturen({ ...opties, nu: maal(basis, 0.6) });
    expect(b.samenvatting.teveelDagen).toBeGreaterThanOrEqual(5);
    expect(b.samenvatting.urenOmlaag).toBe(7);
    const gezien = new Set<NbdActieSoort>();
    for (const dag of b.dagen.filter((d) => d.status === 'teveel')) {
      for (const a of dag.acties) {
        gezien.add(a.soort);
        expect(['inkorten', 'vrijgeven']).toContain(a.soort);
        expect(a.uren).toBeLessThan(0);
        expect(a.slNa!).toBeGreaterThanOrEqual(P.serviceLevel);
        expect(a.overleg).toBe(a.soort === 'vrijgeven');
        if (a.soort === 'inkorten') expect(netto(a.wijzigingen[0][3]!)).toBeGreaterThanOrEqual(P.minDienst);
      }
    }
    expect([...gezien].sort()).toEqual(['inkorten', 'vrijgeven']);
  });
});

describe('NBD bijsturen: kleine gevallen', () => {
  const d = '2026-11-03', morgen = '2026-11-04';
  const ks = kwartierenOpen(P);
  /** Een dag met per kwartier zoveel mensen nodig. */
  const dagMet = (nodig: (t: number) => number): NbdDag => {
    const kwartieren = ks.map((t) => ({ t, gesprekken: nodig(t), nodig: nodig(t) }));
    return { datum: d, uitvaarten: 100, factor: 1, gesprekken: kwartieren.reduce((a, k) => a + k.gesprekken, 0), bron: 'laatste', tijdvakken: [], kwartieren, uren: kwartieren.reduce((a, k) => a + k.nodig, 0) / 4, piek: 3 };
  };

  it('verschuift een pauze uit de drukte naar een rustiger moment', () => {
    const [a, b, c] = [mw('Anna'), mw('Bart'), mw('Cor')];
    const cellen: Cellen = {}, tijden: Tijden = {};
    zet(cellen, tijden, a, d, maakDienst(P, 9, 8, 10)); // pauze om 10:00, midden in de drukte
    zet(cellen, tijden, b, d, maakDienst(P, 9, 8));
    zet(cellen, tijden, c, d, maakDienst(P, 9, 8));
    const dag = dagMet((t) => (t >= 9.5 && t < 12 ? 3 : 2));
    const r = nbdBijsturen({ team: [a, b, c], cellen, tijden, dates: [d], basis: { [d]: dag }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01' });
    const pauze = r.dagen[0].acties.find((x) => x.soort === 'pauze');
    expect(pauze).toBeDefined();
    expect(pauze!.wijzigingen[0][0]).toBe(a.id);
    expect(pauzeBegin(pauze!.wijzigingen[0][3]!)!).toBeGreaterThanOrEqual(12);
    expect(pauze!.uren).toBe(0);
    expect(pauze!.slNa!).toBeGreaterThan(r.dagen[0].sl);
  });

  it('verlengt niet als de rust tot de volgende dienst onder de 11 uur komt', () => {
    const a = mw('Anna');
    const cellen: Cellen = {}, tijden: Tijden = {};
    zet(cellen, tijden, a, d, maakDienst(P, 13, 7.5)); // 13:00-21:00
    zet(cellen, tijden, a, morgen, maakDienst(P, 9, 6)); // morgen om 9:00
    const dag = dagMet(() => 4);
    const r = nbdBijsturen({ team: [a], cellen, tijden, dates: [d], basis: { [d]: dag }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01' });
    const langer = r.dagen[0].acties.filter((x) => x.soort === 'verlengen');
    expect(langer.length).toBeGreaterThan(0);
    // tot 22:00 kan (11 uur rust), later niet; eerder beginnen kan wel
    for (const x of langer) expect(x.wijzigingen[0][3]!.eind).toBeLessThanOrEqual(22);
    // de toets van het hele rooster na elke actie: geen harde overtredingen
    for (const x of langer) {
      const c2: Cellen = JSON.parse(JSON.stringify(cellen)), t2: Tijden = JSON.parse(JSON.stringify(tijden));
      zet(c2, t2, a, d, x.wijzigingen[0][3]!);
      expect(toetsNbd({ team: [a], dates: [d, morgen], cellen: c2, tijden: t2, behoefte: {}, p: P }).hard).toBe(0);
    }
  });

  it('verschuift een training uit de drukte naar een rustiger moment in dezelfde dienst', () => {
    const [a, b] = [mw('Anna'), mw('Bart')];
    const cellen: Cellen = {}, tijden: Tijden = {};
    zet(cellen, tijden, a, d, { ...maakDienst(P, 9, 8, 13), taken: [{ soort: 'training', van: 10, tot: 11 }] });
    zet(cellen, tijden, b, d, maakDienst(P, 9, 8, 13));
    const dag = dagMet((t) => (t >= 9.5 && t < 12 ? 2 : 1));
    const r = nbdBijsturen({ team: [a, b], cellen, tijden, dates: [d], basis: { [d]: dag }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01' });
    const taak = r.dagen[0].acties.find((x) => x.soort === 'taak');
    expect(taak).toBeDefined();
    expect(taak!.tekst).toMatch(/^Anna: training naar .* \(was 10:00–11:00\)$/);
    const y = taak!.wijzigingen[0][3]!;
    expect(y.taken).toHaveLength(1);
    expect(y.taken![0].van).toBeGreaterThanOrEqual(12);
    expect(netto(y)).toBe(netto(maakDienst(P, 9, 8)));
    expect(taak!.uren).toBe(0);
    expect(taak!.slNa!).toBeGreaterThan(r.dagen[0].sl);
  });

  it('verlengt niet in uren die de medewerker niet kan, en de taken gaan mee', () => {
    const a = mw('Anna');
    const cellen: Cellen = {}, tijden: Tijden = {};
    zet(cellen, tijden, a, d, { ...maakDienst(P, 10, 6), taken: [{ soort: 'klachten', van: 11, tot: 12 }] });
    // de hele dinsdag kan niet na 18:00
    const rij = [...'.'.repeat(11), ...'n'.repeat(5)].join('');
    const uren = { even: Array(7).fill(rij), oneven: Array(7).fill(rij) };
    const profielen = { [a.id]: { medewerkerId: a.id, dagen: Array(7).fill('neutraal'), dienst: 'geen' as const, beschikbaarheid: 'neutraal' as const, maxDagenPerWeek: null, uren, bijgewerkt: '' } };
    const dag = dagMet(() => 3);
    const r = nbdBijsturen({ team: [a], cellen, tijden, dates: [d], basis: { [d]: dag }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01', profielen });
    const langer = r.dagen[0].acties.filter((x) => x.soort === 'verlengen');
    expect(langer.length).toBeGreaterThan(0);
    for (const x of langer) {
      const y = x.wijzigingen[0][3]!;
      expect(y.eind).toBeLessThanOrEqual(18);
      expect(y.taken).toEqual([{ soort: 'klachten', van: 11, tot: 12 }]);
    }
  });

  it('stelt geen extra werk voor bij een open verlofaanvraag', () => {
    const [a, b] = [mw('Anna'), mw('Bart')];
    const cellen: Cellen = {}, tijden: Tijden = {};
    zet(cellen, tijden, a, d, maakDienst(P, 10, 6));
    const dag = dagMet(() => 2);
    const aanvragen = [{ id: 'v1', medewerkerId: a.id, regio: NBD, van: d, tot: d, soort: 'vakantie' as const, status: 'aangevraagd' as const, aangevraagd: '2026-10-01' }, { id: 'v2', medewerkerId: b.id, regio: NBD, van: d, tot: d, soort: 'vakantie' as const, status: 'aangevraagd' as const, aangevraagd: '2026-10-01' }];
    const r = nbdBijsturen({ team: [a, b], cellen, tijden, dates: [d], basis: { [d]: dag }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01', aanvragen });
    expect(r.dagen[0].status).toBe('tekort');
    expect(r.dagen[0].acties.filter((x) => x.soort === 'verlengen' || x.soort === 'inplannen')).toEqual([]);
  });

  it('een langere dienst houdt zijn training; de pauze komt eromheen', () => {
    const a = mw('Anna');
    const cellen: Cellen = {}, tijden: Tijden = {};
    // 9:00-14:00 zonder pauze, met training van 13:00 tot 14:00
    zet(cellen, tijden, a, d, { start: 9, eind: 14, pauze: 0, taken: [{ soort: 'training', van: 13, tot: 14 }] });
    const dag = dagMet(() => 3);
    const r = nbdBijsturen({ team: [a], cellen, tijden, dates: [d], basis: { [d]: dag }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01' });
    const langer = r.dagen[0].acties.filter((x) => x.soort === 'verlengen');
    expect(langer.length).toBeGreaterThan(0);
    for (const x of langer) {
      const y = x.wijzigingen[0][3]!;
      expect(y.taken).toEqual([{ soort: 'training', van: 13, tot: 14 }]);
      expect(x.tekst).not.toMatch(/vervalt/);
      if (y.pauze) {
        const b = pauzeBegin(y)!;
        expect(b + y.pauze / 60 <= 13 + 1e-9 || b >= 14 - 1e-9).toBe(true);
      }
    }
  });

  it('vrij geven laat wie die dag bij de maandstart is staan', () => {
    const [a, b] = [mw('Anna'), mw('Bart')];
    const cellen: Cellen = {}, tijden: Tijden = {};
    zet(cellen, tijden, a, d, { ...maakDienst(P, 9, 8, 13), taken: [{ soort: 'maandstart', van: 10, tot: 11 }] });
    zet(cellen, tijden, b, d, maakDienst(P, 9, 8, 13));
    const dag = dagMet(() => 1);
    const r = nbdBijsturen({ team: [a, b], cellen, tijden, dates: [d], basis: { [d]: dagMet(() => 2) }, nu: { [d]: dag }, p: P, beleid: STANDAARD_BELEID, vandaag: '2026-10-01' });
    const vrij = r.dagen[0].acties.filter((x) => x.soort === 'vrijgeven');
    for (const x of vrij) expect(x.wijzigingen[0][0]).toBe(b.id);
  });
});
